import { foldName, type ProjectLanguage } from "../domain";

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
 *   - [[22_World_Status/Injured/Injured|Injured]] when [[Year 1024]]
 *   - [[23_Relationship/Member/Member|Member]]: Guild Master -> [[Guild]]
 *
 * The label links the node's own note -- named after its folder, so the
 * target ends in a repeated leaf, `…/Member/Member` -- and its alias is the
 * taxonomy path.
 *
 * The value belongs to this record on this note; only the label is shared
 * vocabulary. Clauses keep the order they were added in, and a connector says
 * what kind of note follows: `at` a location, `when` a time, `with` anyone
 * else, and `->` the one target a relationship is with. A connector reads as
 * a connector only in front of a link -- the plugin never writes one anywhere
 * else -- so a value stays free prose even when it contains the words `at`,
 * `from` or an arrow of its own. `from … to …` is read and re-emitted for
 * records written before spans became period notes, but nothing writes a new
 * one.
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

/** The taxonomy node a record points at: `[[…/<path>/<leaf>|<taxonomy path>]]`. */
export interface RecordLabel {
  /** The node's own note, as a full vault path without its extension. */
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

export interface ParsedRecordSection {
  records: RecordLine[];
  /** Lines the grammar does not cover, re-emitted verbatim after the records. */
  unrecognized: string[];
}

/** The record sections a member note can carry, in the order they read. */
export type RecordSectionId = "world-status" | "relationships";

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
  /** What each section's callout is titled, the way the overview is titled. */
  sectionTitles: Record<RecordSectionId, string>;
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
    sectionTitles: {
      "world-status": "World status",
      relationships: "Relationships",
    },
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
    sectionTitles: {
      "world-status": "状态",
      relationships: "关系",
    },
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
      ? labelLink(record.label)
      : `${labelLink(record.label)}${copy.valueSeparator}${value}`;
  const clauses = record.clauses.flatMap((clause) =>
    renderClause(copy, clause, spanOf),
  );
  return [head, ...clauses].join(" ");
}

/** What a section's callout is titled, in the project's language. */
export function recordSectionTitle(
  id: RecordSectionId,
  language: ProjectLanguage,
): string {
  return COPY[language].sectionTitles[id];
}

/**
 * A record section as it is written: a titled callout holding one record per
 * paragraph, the same box the overview above it reads as, and separated the
 * same way. The callout is what says which section this is, so the sections
 * carry no headings of their own.
 *
 * The syntax is spelled out here rather than shared with the overview's
 * renderer, which sits downstream of this module and cannot be reached from
 * it. Both write the plainest callout there is.
 */
function renderRecordCallout(title: string, lines: readonly string[]): string {
  const rendered: string[] = [`> [!info] ${title}`];
  lines.forEach((line, index) => {
    if (index > 0) rendered.push(">");
    rendered.push(`> ${line}`.trimEnd());
  });
  return rendered.join("\n");
}

export function renderRecordSection(
  language: ProjectLanguage,
  id: RecordSectionId,
  records: readonly RecordLine[],
  unrecognized: readonly string[] = [],
  spanOf: SpanLookup | null = null,
): string {
  return renderRecordCallout(recordSectionTitle(id, language), [
    ...records.map((record) => renderRecordLine(language, record, spanOf)),
    ...unrecognized,
  ]);
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

const LENIENT_LANGUAGES: readonly ProjectLanguage[] = ["en", "zh-CN"];

/**
 * Reads a section line by line, trying the preferred language first and the
 * other after it: a project whose language was switched still reads the lines
 * written before the switch, and re-emits them in the language it has now.
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

function contentLines(content: string): string[] {
  const lines = content
    .split(/\r\n|\r|\n/u)
    .map((line) => line.replace(/\s+$/u, ""))
    .map((line) => (line.startsWith(">") ? line.replace(/^>[ \t]?/u, "") : line))
    .filter((line) => line.trim().length > 0);
  // The callout title is the section's own furniture, but only the one the
  // section opens with. A callout header typed further down is somebody
  // else's content: it flows to the unrecognized bucket and is kept, like
  // every other line the grammar does not cover.
  const title = lines.findIndex((line) => /^\[![a-z]+\]/iu.test(line.trim()));
  return lines.filter((line, at) => at !== title);
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
 * counts only with spaces on both sides, outside wikilink brackets, and in
 * front of a link: every clause the plugin writes points its connector at a
 * link, so a connector word in front of anything else is the value's own
 * prose -- "Escaped from prison" is a value, not half a span.
 */
function parseClauses(copy: RecordCopy, tail: string): ClauseSplit | null {
  // Padded so a connector at the very start still sits between spaces.
  const padded = ` ${stripDerivedSpans(copy, tail)}`;
  let marks: ConnectorMark[] = [
    ...connectorMarks(padded, copy.arrow, "target"),
    ...connectorMarks(padded, copy.at, "at"),
    ...connectorMarks(padded, copy.when, "when"),
    ...connectorMarks(padded, copy.with, "with"),
    ...connectorMarks(padded, copy.from, "span"),
  ].sort((left, right) => left.index - right.index);

  // A mark whose segment does not read as a clause after all is prose, not
  // half a clause: the mark comes back out and the words stay where the
  // author put them, which also re-widens the segment before it.
  for (;;) {
    const read = readClauses(copy, padded, marks);
    if (read.ok) return read.split;
    if (read.dropped === null) return null;
    const dropped = read.dropped;
    marks = marks.filter((mark) => mark !== dropped);
  }
}

function readClauses(
  copy: RecordCopy,
  padded: string,
  marks: readonly ConnectorMark[],
):
  | { ok: true; split: ClauseSplit }
  | { ok: false; dropped: ConnectorMark | null } {
  const head = padded.slice(0, marks[0]?.index ?? padded.length).trim();
  const clauses: RecordClause[] = [];
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index] as ConnectorMark;
    const next = marks[index + 1];
    const text = padded
      .slice(mark.index + mark.token.length, next?.index ?? padded.length)
      .trim();
    if (text.length === 0) return { ok: false, dropped: null };
    if (mark.kind === "span") {
      const span = parseSpan(copy, text);
      if (span === null) return { ok: false, dropped: mark };
      clauses.push(span);
      continue;
    }
    const term = parseTerm(text);
    if (term.kind !== "link") return { ok: false, dropped: mark };
    clauses.push({ kind: mark.kind, term });
  }
  return { ok: true, split: { head, clauses } };
}

/**
 * A span clause is two linked ends or it is not a span: `from … to …` occurs
 * in ordinary prose far too often to read on the words alone.
 */
function parseSpan(copy: RecordCopy, text: string): RecordClause | null {
  const span = ` ${text}`;
  const toIndex = connectorIndex(span, copy.to);
  if (toIndex === null) return null;
  const start = parseTerm(span.slice(0, toIndex).trim());
  const end = parseTerm(
    span.slice(toIndex + connectorToken(copy.to).length).trim(),
  );
  if (start.kind !== "link" || end.kind !== "link") return null;
  return { kind: "span", start, end };
}

/**
 * Takes back out what the renderer wrote in for the reader: the two ends of a
 * period, in brackets behind the period itself. They are derived from the time
 * note, so a line read back must not find them, or the record would gain a
 * clause nobody wrote and grow another pair on every save.
 *
 * A period's ends are whatever its frontmatter holds -- links or plain words
 * -- so the shape inside the brackets is only `from <something> to
 * <something>`. What keeps an author's own "(from … to …)" safe is the term
 * in front: the renderer writes a span only behind a linked period, so a
 * bracket after plain prose is left where the author put it.
 */
function stripDerivedSpans(copy: RecordCopy, tail: string): string {
  const open = `${copy.spanOpen}${copy.from} `;
  const pattern = new RegExp(
    `^${escapeForPattern(copy.from)}\\s+\\S(?:.*\\S)?\\s+${escapeForPattern(copy.to)}\\s+\\S.*$`,
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
      const behindLink = result.replace(/\s+$/u, "").endsWith("]]");
      const close = behindLink
        ? closingIndex(tail, index + open.length, copy.spanClose)
        : null;
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

/**
 * Every occurrence of ` connector ` outside wikilink brackets that stands in
 * front of a link. The plugin only ever writes a connector in front of one,
 * so anywhere else the word is prose.
 */
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
      let peek = index + token.length;
      while (text[peek] === " ") peek += 1;
      if (text.startsWith("[[", peek)) marks.push({ kind, index, token });
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

/**
 * A record as it stands on its line. The records are paragraphs of a callout
 * now; a bullet in front of one is how they were written for a while, and it
 * comes off rather than making the line unreadable.
 */
function listItemBody(line: string): string | null {
  const trimmed = line.trim();
  return trimmed.startsWith("- ") ? trimmed.slice(2).trim() : trimmed;
}

const NODE_LABEL_PATTERN = /^\[\[([^\]|#]+)\|([^\]]+)\]\]/u;

/**
 * The label a record line opens with. Only a link whose target ends in the
 * node's own note counts -- a leaf repeating the folder before it -- so a
 * line that merely begins with some other link is not mistaken for a
 * record.
 */
function takeLabelLink(
  body: string,
): { label: RecordLabel; rest: string } | null {
  const node = NODE_LABEL_PATTERN.exec(body);
  if (node === null) return null;
  const target = (node[1] ?? "").trim().replace(/\.md$/u, "");
  const segments = target.split("/");
  const last = segments[segments.length - 1] ?? "";
  const parent = segments[segments.length - 2];
  if (parent === undefined || foldName(last) !== foldName(parent)) return null;
  return {
    label: { path: target, display: (node[2] ?? "").trim() },
    rest: body.slice(node[0].length).trim(),
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

/** The name a bare link falls back to: its last segment. */
function nameFromPath(path: string): string {
  const segments = path
    .replace(/\.md$/u, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments.pop() ?? path;
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
