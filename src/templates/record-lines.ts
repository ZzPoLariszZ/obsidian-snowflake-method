import {
  DEFINITION_NODE_BASENAME,
  type DetailsPropertyId,
  type ProjectLanguage,
} from "../domain";

/**
 * The record-line codec: the one grammar every compound property is written
 * in. Frontmatter can hold at most one wikilink per list entry, so a value
 * that mixes text and links, or several links, lives in the note body as one
 * record per line. The plugin is the only writer of these sections, which is
 * what makes parsing safe: the reader is reading its own normalized output.
 *
 * A record is a label from the kind's taxonomy, an optional value of its own,
 * and any number of clauses pointing at other notes:
 *
 *   - [[22_World_Status/Injured/_self|Injured]] when [[Year 1024]]
 *   - [[23_Relationship/Member/_self|Member]]: Guild Master -> [[Guild]]
 *
 * The label links the node's `_self.md`, and its alias is the taxonomy path.
 * Labels written before nodes were folders pointed a heading inside the file
 * the tree grew out of, `[[23_Relationship#Member|Member]]`; the parser still
 * reads that form and maps it onto the node it names, so the next write of
 * the section is what re-emits it the current way.
 *
 * The value belongs to this record on this note; only the label is shared
 * vocabulary. Clauses keep the order they were added in, and a connector says
 * what kind of note follows: `at` a location, `when` a time, `with` anyone
 * else, and `->` the one target a relationship is with. `from … to …` is read
 * and re-emitted for records written before spans became period notes, but
 * nothing writes a new one.
 *
 * A Details line is the same tail behind a built-in bold label instead of a
 * taxonomy link, for the one property that is not user vocabulary:
 *
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

/** What a clause says about the note it points at. */
export type RecordClauseKind = "target" | "at" | "when" | "with";

export type RecordClause =
  | { kind: RecordClauseKind; term: RecordTerm }
  | { kind: "span"; start: RecordTerm; end: RecordTerm };

/** The taxonomy node a record points at: `[[…/<path>/_self|<taxonomy path>]]`. */
export interface RecordLabel {
  /** The node's `_self` note, as a full vault path without its extension. */
  path: string;
  /** The taxonomy path the label is read as, kept as the link's alias. */
  display: string;
}

export interface RecordLine {
  label: RecordLabel;
  /** This record's own text, kept on the note rather than in the taxonomy. */
  value: string;
  clauses: RecordClause[];
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
  with: string;
  from: string;
  to: string;
  /** The brackets a period's span is shown in behind the period itself. */
  spanOpen: string;
  spanClose: string;
  valueSeparator: string;
  detailsLabels: Record<DetailsPropertyId, string>;
}

const COPY: Record<ProjectLanguage, RecordCopy> = {
  en: {
    arrow: "->",
    at: "at",
    when: "when",
    with: "with",
    from: "from",
    to: "to",
    spanOpen: "(",
    spanClose: ")",
    valueSeparator: ": ",
    detailsLabels: { owner: "Owner" },
  },
  "zh-CN": {
    arrow: "->",
    at: "在",
    when: "于",
    with: "与",
    from: "从",
    to: "至",
    spanOpen: "（",
    spanClose: "）",
    valueSeparator: "：",
    detailsLabels: { owner: "所有者" },
  },
};

/**
 * What a time note spans, for the periods a record points at. A period is a
 * stretch, and a line saying only which stretch leaves the reader to go and
 * look up when that was: the two ends are written in behind it.
 *
 * Derived, never stored: the parser drops what this adds, so the record model
 * is the same whether or not the ends were written, and a period whose ends
 * change is put right by the next write of the notes that name it.
 */
export type SpanLookup = (
  path: string,
) => { start: RecordTerm; end: RecordTerm } | null;

/** The connector a clause of each kind is written with. */
export function recordClauseConnector(
  language: ProjectLanguage,
  kind: RecordClauseKind,
): string {
  const copy = COPY[language];
  if (kind === "target") return copy.arrow;
  if (kind === "at") return copy.at;
  if (kind === "when") return copy.when;
  return copy.with;
}

export function recordDetailsLabel(
  language: ProjectLanguage,
  property: DetailsPropertyId,
): string {
  return COPY[language].detailsLabels[property];
}

export function renderRecordLine(
  language: ProjectLanguage,
  record: RecordLine,
  spanOf: SpanLookup | null = null,
): string {
  const copy = COPY[language];
  const value = record.value.trim();
  // The separator carries its own spacing, because Chinese wants none after
  // its colon and English wants one.
  const head =
    value.length === 0
      ? `- ${labelLink(record.label)}`
      : `- ${labelLink(record.label)}${copy.valueSeparator}${value}`;
  const clauses = record.clauses.flatMap((clause) =>
    renderClause(copy, clause, spanOf),
  );
  return [head, ...clauses].join(" ");
}

export function renderDetailsLine(
  language: ProjectLanguage,
  details: DetailsLine,
): string {
  const copy = COPY[language];
  const clauses: RecordClause[] = [];
  if (details.location !== null) {
    clauses.push({ kind: "at", term: details.location });
  }
  if (details.time !== null) {
    clauses.push(
      details.time.kind === "when"
        ? { kind: "when", term: details.time.at }
        : { kind: "span", start: details.time.start, end: details.time.end },
    );
  }
  const tail = [
    ...(details.value === null ? [] : [renderTerm(details.value)]),
    ...clauses.flatMap((clause) => renderClause(copy, clause)),
  ].join(" ");
  return `- **${copy.detailsLabels[details.property]}**${copy.valueSeparator}${tail}`.trimEnd();
}

export function renderRecordSection(
  language: ProjectLanguage,
  records: readonly RecordLine[],
  unrecognized: readonly string[] = [],
  spanOf: SpanLookup | null = null,
): string {
  return [
    ...records.map((record) => renderRecordLine(language, record, spanOf)),
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
  const split = splitValueAndClauses(copy, label.rest);
  if (split === null) return null;
  return { label: label.label, value: split.value, clauses: split.clauses };
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
  ).find(([, text]) =>
    body.startsWith(`**${text}**${copy.valueSeparator.trimEnd()}`),
  );
  if (property === undefined) return null;
  const tail = body
    .slice(`**${property[1]}**${copy.valueSeparator.trimEnd()}`.length)
    .trim();
  const clauses = parseClauses(copy, tail);
  if (clauses === null) return null;
  // Details name one property, so they hold one place and one time at most,
  // and never a target: anything else is a line this grammar cannot claim.
  let location: RecordTerm | null = null;
  let time: RecordTime | null = null;
  for (const clause of clauses.clauses) {
    if (clause.kind === "at" && location === null) location = clause.term;
    else if (clause.kind === "when" && time === null) {
      time = { kind: "when", at: clause.term };
    } else if (clause.kind === "span" && time === null) {
      time = { kind: "span", start: clause.start, end: clause.end };
    } else return null;
  }
  return {
    property: property[0],
    value: clauses.head.length === 0 ? null : parseTerm(clauses.head),
    location,
    time,
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

function renderClause(
  copy: RecordCopy,
  clause: RecordClause,
  spanOf: SpanLookup | null = null,
): string[] {
  if (clause.kind === "span") {
    return [
      copy.from,
      renderTerm(clause.start),
      copy.to,
      renderTerm(clause.end),
    ];
  }
  const term = renderTerm(clause.term);
  const span =
    clause.kind === "when" && clause.term.kind === "link" && spanOf !== null
      ? spanOf(clause.term.path)
      : null;
  if (span === null) return [recordConnector(copy, clause.kind), term];
  return [
    recordConnector(copy, clause.kind),
    term,
    `${copy.spanOpen}${copy.from}`,
    renderTerm(span.start),
    copy.to,
    `${renderTerm(span.end)}${copy.spanClose}`,
  ];
}

function recordConnector(copy: RecordCopy, kind: RecordClauseKind): string {
  if (kind === "target") return copy.arrow;
  if (kind === "at") return copy.at;
  if (kind === "when") return copy.when;
  return copy.with;
}

interface ClauseSplit {
  /** Text before the first connector: the value, or empty. */
  head: string;
  clauses: RecordClause[];
}

/**
 * Reads a record's tail: an optional value behind the separator, then the
 * clauses. A tail that is neither -- text with no separator in front of it --
 * is not this grammar, and the caller keeps the line verbatim.
 */
function splitValueAndClauses(
  copy: RecordCopy,
  tail: string,
): { value: string; clauses: RecordClause[] } | null {
  const separator = copy.valueSeparator.trimEnd();
  if (tail.startsWith(separator)) {
    const parsed = parseClauses(copy, tail.slice(separator.length).trim());
    if (parsed === null || parsed.head.length === 0) return null;
    return { value: parsed.head, clauses: parsed.clauses };
  }
  const parsed = parseClauses(copy, tail);
  if (parsed === null || parsed.head.length > 0) return null;
  return { value: "", clauses: parsed.clauses };
}

interface ConnectorMark {
  kind: RecordClauseKind | "span";
  index: number;
  token: string;
}

/**
 * Splits a tail at its connectors, in the order they appear. A connector
 * counts only with spaces on both sides and outside wikilink brackets, so a
 * link text may contain a connector word without splitting the record. Every
 * connector must be followed by something; anything else is not this grammar.
 */
function parseClauses(copy: RecordCopy, tail: string): ClauseSplit | null {
  // Padded so a connector at the very start still sits between spaces.
  const padded = ` ${stripDerivedSpans(copy, tail)}`;
  const marks: ConnectorMark[] = [
    ...connectorMarks(padded, copy.arrow, "target"),
    ...connectorMarks(padded, copy.at, "at"),
    ...connectorMarks(padded, copy.when, "when"),
    ...connectorMarks(padded, copy.with, "with"),
    ...connectorMarks(padded, copy.from, "span"),
  ].sort((left, right) => left.index - right.index);

  const head = padded.slice(0, marks[0]?.index ?? padded.length).trim();
  const clauses: RecordClause[] = [];
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index] as ConnectorMark;
    const next = marks[index + 1];
    const text = padded
      .slice(mark.index + mark.token.length, next?.index ?? padded.length)
      .trim();
    if (text.length === 0) return null;
    if (mark.kind === "span") {
      const span = ` ${text}`;
      const toIndex = connectorIndex(span, copy.to);
      if (toIndex === null) return null;
      const start = span.slice(0, toIndex).trim();
      const end = span.slice(toIndex + connectorToken(copy.to).length).trim();
      if (start.length === 0 || end.length === 0) return null;
      clauses.push({
        kind: "span",
        start: parseTerm(start),
        end: parseTerm(end),
      });
      continue;
    }
    clauses.push({ kind: mark.kind, term: parseTerm(text) });
  }
  return { head, clauses };
}

/**
 * Takes back out what the renderer wrote in for the reader: the two ends of a
 * period, in brackets behind the period itself. They are derived from the time
 * note, so a line read back must not find them, or the record would gain a
 * clause nobody wrote and grow another pair on every save.
 *
 * Only an exact `(from <link> to <link>)` is taken, so a bracket an author put
 * in a value of their own is left where they put it.
 */
function stripDerivedSpans(copy: RecordCopy, tail: string): string {
  const open = `${copy.spanOpen}${copy.from} `;
  const pattern = new RegExp(
    `^${escapeForPattern(copy.from)}\\s+\\[\\[[^\\]]+\\]\\]\\s+${escapeForPattern(copy.to)}\\s+\\[\\[[^\\]]+\\]\\]$`,
    "u",
  );
  let result = "";
  let index = 0;
  let depth = 0;
  while (index < tail.length) {
    if (tail.startsWith("[[", index)) {
      depth += 1;
      result += "[[";
      index += 2;
      continue;
    }
    if (tail.startsWith("]]", index)) {
      depth = Math.max(0, depth - 1);
      result += "]]";
      index += 2;
      continue;
    }
    if (depth === 0 && tail.startsWith(open, index)) {
      const close = closingIndex(tail, index + open.length, copy.spanClose);
      const inner =
        close === null
          ? null
          : tail.slice(index + copy.spanOpen.length, close).trim();
      if (close !== null && inner !== null && pattern.test(inner)) {
        // The space that held it apart from the term before goes with it.
        result = result.replace(/\s+$/u, "");
        index = close + copy.spanClose.length;
        continue;
      }
    }
    result += tail[index];
    index += 1;
  }
  return result;
}

/** The bracket that closes a run, outside any wikilink inside it. */
function closingIndex(
  text: string,
  from: number,
  close: string,
): number | null {
  let depth = 0;
  for (let index = from; index < text.length; index += 1) {
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
    if (depth === 0 && text.startsWith(close, index)) return index;
  }
  return null;
}

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Every occurrence of ` connector ` outside wikilink brackets. */
function connectorMarks(
  text: string,
  connector: string,
  kind: RecordClauseKind | "span",
): ConnectorMark[] {
  const token = connectorToken(connector);
  const marks: ConnectorMark[] = [];
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
    if (depth === 0 && text.startsWith(token, index)) {
      marks.push({ kind, index, token });
      index += token.length - 2;
    }
  }
  return marks;
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

const NODE_LABEL_PATTERN = /^\[\[([^\]|#]+)\|([^\]]+)\]\]/u;
const LEGACY_LABEL_PATTERN = /^\[\[([^\]|#]*)#([^\]|]+)\|([^\]]+)\]\]/u;

/**
 * The label a record line opens with. Only a link whose target ends in the
 * node file counts, so a line that merely begins with some other link is not
 * mistaken for a record. The legacy heading form maps totally onto a node:
 * the file it pointed into is the folder the tree stands at now, and the
 * alias was already the taxonomy path, so the two compose into the node's
 * `_self` path and the model never holds the old shape.
 */
function takeLabelLink(
  body: string,
): { label: RecordLabel; rest: string } | null {
  const node = NODE_LABEL_PATTERN.exec(body);
  if (node !== null) {
    const target = (node[1] ?? "").trim().replace(/\.md$/u, "");
    if (target.split("/").pop() !== DEFINITION_NODE_BASENAME) return null;
    return {
      label: { path: target, display: (node[2] ?? "").trim() },
      rest: body.slice(node[0].length).trim(),
    };
  }
  const legacy = LEGACY_LABEL_PATTERN.exec(body);
  if (legacy === null) return null;
  const display = (legacy[3] ?? "").trim();
  const path = [
    (legacy[1] ?? "").trim().replace(/\.md$/u, ""),
    ...display.split("/"),
    DEFINITION_NODE_BASENAME,
  ]
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("/");
  return {
    label: { path, display },
    rest: body.slice(legacy[0].length).trim(),
  };
}

function labelLink(label: RecordLabel): string {
  const target = label.path.trim().replace(/\.md$/u, "");
  return `[[${target}|${sanitizeAlias(label.display)}]]`;
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
    name: alias.length > 0 ? alias : nameFromPath(path),
  };
}

/**
 * The name a bare link falls back to: its last segment, or the one before it
 * when the last is the node file every definition folder holds, which is a
 * file name and never anything a reader should see.
 */
function nameFromPath(path: string): string {
  const segments = path
    .replace(/\.md$/u, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const last = segments.pop() ?? path;
  if (last !== DEFINITION_NODE_BASENAME) return last;
  return segments.pop() ?? last;
}

export function renderTerm(term: RecordTerm): string {
  if (term.kind === "text") return term.text.trim();
  const target = term.path.trim().replace(/\.md$/u, "");
  const name = sanitizeAlias(term.name);
  if (target.length === 0) return name;
  // Links carry the full vault path, and a link with no display name is read
  // out as that path wherever the note is rendered. So the name is written
  // whenever it is not already the whole target: these lines are read as
  // prose, not as a listing of where the files are.
  return name.length === 0 || name === target
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
