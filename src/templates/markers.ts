export const SECTION_MARKER_PREFIX = "snowflake:section";

export type MarkerBoundary = "start" | "end";

export type MarkerIssueCode =
  | "missing"
  | "missing-start"
  | "missing-end"
  | "duplicate-start"
  | "duplicate-end"
  | "reversed"
  | "unknown-section"
  | "overlap"
  /**
   * A line in a record section the grammar cannot read. Informational, never
   * blocking: the line is kept verbatim, and only the author can resolve it.
   */
  | "unrecognized-record";

export interface SectionMarkers {
  start: string;
  end: string;
}

export type ManagedSectionHealth =
  | {
      status: "present";
      code: null;
      path: string | null;
      sectionId: string;
      start: number;
      contentStart: number;
      contentEnd: number;
      end: number;
    }
  | {
      status: "missing";
      path: string | null;
      sectionId: string;
      code: "missing";
      reason: string;
    }
  | {
      status: "invalid";
      path: string | null;
      sectionId: string;
      code: Exclude<MarkerIssueCode, "missing" | "unknown-section" | "overlap">;
      reason: string;
    };

export type SectionInspection = ManagedSectionHealth;

export interface ManagedMarkerIssue {
  code: MarkerIssueCode;
  sectionId: string | null;
  reason: string;
  from?: number;
  to?: number;
  relatedSectionId?: string;
}

export interface ProtectedMarkerRange {
  from: number;
  to: number;
  markerFrom: number;
  markerTo: number;
  sectionId: string;
  boundary: MarkerBoundary;
}

export interface ManagedSectionsInspection {
  sections: ManagedSectionHealth[];
  issues: ManagedMarkerIssue[];
}

export type SectionUpdateResult =
  | { ok: true; content: string; changed: boolean }
  | { ok: false; code: MarkerIssueCode; reason: string };

interface MarkerOccurrence {
  raw: string;
  from: number;
  to: number;
  sectionId: string | null;
  boundary: MarkerBoundary | null;
  canonical: boolean;
}

const SECTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MARKER_LIKE_PATTERN = /<!--[^\r\n]*?snowflake\s*:\s*section[^\r\n]*?(?:-->|$)/giu;
const TOLERANT_MARKER_PATTERN =
  /^<!--\s*snowflake\s*:\s*section\s*:\s*([a-z0-9][a-z0-9-]*)\s*:\s*(start|end)\s*-->$/iu;
const TOLERANT_SECTION_ID_PATTERN =
  /^<!--\s*snowflake\s*:\s*section\s*:\s*([^:\s>]+)/iu;

export function sectionMarkers(sectionId: string): SectionMarkers {
  if (!SECTION_ID_PATTERN.test(sectionId)) {
    throw new Error(`Invalid Snowflake section id: ${sectionId}`);
  }

  return {
    start: `<!-- ${SECTION_MARKER_PREFIX}:${sectionId}:start -->`,
    end: `<!-- ${SECTION_MARKER_PREFIX}:${sectionId}:end -->`,
  };
}

export function renderMarkedSection(sectionId: string, initialContent = ""): string {
  return renderMarkedSectionWithEol(
    sectionId,
    initialContent,
    preferredLineEnding(initialContent),
  );
}

export function inspectMarkedSection(
  content: string,
  sectionId: string,
  path: string | null = null,
): SectionInspection {
  const markers = sectionMarkers(sectionId);
  const canonicalOccurrences = scanMarkerOccurrences(content).filter(
    (occurrence) =>
      occurrence.canonical && occurrence.sectionId === sectionId,
  );
  const starts = canonicalOccurrences
    .filter((occurrence) => occurrence.boundary === "start")
    .map((occurrence) => occurrence.from);
  const ends = canonicalOccurrences
    .filter((occurrence) => occurrence.boundary === "end")
    .map((occurrence) => occurrence.from);
  if (starts.length === 0 && ends.length === 0) {
    return {
      status: "missing",
      path,
      sectionId,
      code: "missing",
      reason: `Section "${sectionId}" is missing its managed markers.`,
    };
  }
  if (starts.length === 0) {
    return invalidHealth(
      sectionId,
      "missing-start",
      `Section "${sectionId}" is missing its start marker.`,
      path,
    );
  }
  if (ends.length === 0) {
    return invalidHealth(
      sectionId,
      "missing-end",
      `Section "${sectionId}" is missing its end marker.`,
      path,
    );
  }
  if (starts.length !== 1) {
    return invalidHealth(
      sectionId,
      "duplicate-start",
      `Section "${sectionId}" has more than one start marker.`,
      path,
    );
  }
  if (ends.length !== 1) {
    return invalidHealth(
      sectionId,
      "duplicate-end",
      `Section "${sectionId}" has more than one end marker.`,
      path,
    );
  }

  const start = starts[0]!;
  const end = ends[0]!;
  if (end <= start) {
    return invalidHealth(
      sectionId,
      "reversed",
      `The end marker precedes the start marker for section "${sectionId}".`,
      path,
    );
  }

  let contentStart = start + markers.start.length;
  if (content.slice(contentStart, contentStart + 2) === "\r\n") {
    contentStart += 2;
  } else if (content[contentStart] === "\n") {
    contentStart += 1;
  }

  let contentEnd = end;
  if (content.slice(Math.max(contentStart, end - 2), end) === "\r\n") {
    contentEnd -= 2;
  } else if (content[end - 1] === "\n") {
    contentEnd -= 1;
  }

  return {
    status: "present",
    code: null,
    path,
    sectionId,
    start,
    contentStart,
    contentEnd,
    end,
  };
}

export function inspectManagedSections(
  content: string,
  sectionIds: readonly string[],
  path: string | null = null,
): ManagedSectionHealth[] {
  return [...new Set(sectionIds)].map((sectionId) =>
    inspectMarkedSection(content, sectionId, path),
  );
}

export function inspectManagedDocumentSections(
  content: string,
  expectedSectionIds: readonly string[],
  path: string | null = null,
): ManagedSectionsInspection {
  return {
    sections: inspectManagedSections(content, expectedSectionIds, path),
    issues: findManagedMarkerIssues(content, expectedSectionIds),
  };
}

/**
 * Finds structural issues without treating a valid, unknown section as damage.
 * Unknown canonical sections are reported so callers can surface them, but they
 * remain compatible with newer templates when they do not overlap known data.
 */
export function findManagedMarkerIssues(
  content: string,
  expectedSectionIds: readonly string[],
): ManagedMarkerIssue[] {
  const expected = new Set(expectedSectionIds);
  const occurrences = scanMarkerOccurrences(content);
  const discovered = new Set(
    occurrences
      .filter((occurrence) => occurrence.canonical)
      .map((occurrence) => occurrence.sectionId)
      .filter(
        (sectionId): sectionId is string =>
          sectionId !== null && SECTION_ID_PATTERN.test(sectionId),
      ),
  );
  const allSectionIds = [...new Set([...expectedSectionIds, ...discovered])];
  const issues: ManagedMarkerIssue[] = [];

  // Only registered sections participate in structural health. A canonical
  // marker with an unknown id may be future-compatible or simply mistyped;
  // either way, it must not create a phantom section with a second
  // missing-start/end error.
  for (const health of inspectManagedSections(content, expectedSectionIds)) {
    if (health.status === "invalid") {
      pushUniqueIssue(issues, {
        code: health.code,
        sectionId: health.sectionId,
        reason: health.reason,
      });
    } else if (health.status === "missing" && expected.has(health.sectionId)) {
      pushUniqueIssue(issues, {
        code: health.code,
        sectionId: health.sectionId,
        reason: health.reason,
      });
    }
  }

  for (const occurrence of occurrences) {
    if (!occurrence.canonical) continue;
    if (occurrence.sectionId !== null && !expected.has(occurrence.sectionId)) {
      pushUniqueIssue(issues, {
        code: "unknown-section",
        sectionId: occurrence.sectionId,
        reason: `Section "${occurrence.sectionId}" is not part of the expected template.`,
        from: occurrence.from,
        to: occurrence.to,
      });
    }
  }

  const present = allSectionIds
    .map((sectionId) => inspectMarkedSection(content, sectionId))
    .filter(
      (health): health is Extract<ManagedSectionHealth, { status: "present" }> =>
        health.status === "present",
    )
    .sort((left, right) => left.start - right.start);
  let active = present[0];
  for (const current of present.slice(1)) {
    if (active && current.start < active.end) {
      pushUniqueIssue(issues, {
        code: "overlap",
        sectionId: current.sectionId,
        relatedSectionId: active.sectionId,
        reason: `Managed sections "${active.sectionId}" and "${current.sectionId}" overlap or are nested.`,
      });
    }
    if (!active || current.end > active.end) active = current;
  }

  return issues;
}

/** Returns complete line ranges for canonical marker-only lines. */
export function getProtectedMarkerRanges(content: string): ProtectedMarkerRange[] {
  const ranges: ProtectedMarkerRange[] = [];
  let lineFrom = 0;
  while (lineFrom <= content.length) {
    const newline = content.indexOf("\n", lineFrom);
    const lineTo = newline === -1 ? content.length : newline + 1;
    const contentTo = newline === -1 ? content.length : newline;
    const withoutCarriageReturn =
      contentTo > lineFrom && content[contentTo - 1] === "\r"
        ? contentTo - 1
        : contentTo;
    const line = content.slice(lineFrom, withoutCarriageReturn);
    const leading = line.length - line.trimStart().length;
    const trimmed = line.trim();
    const parsed = parseTolerantMarker(trimmed);
    if (parsed && trimmed === sectionMarkers(parsed.sectionId)[parsed.boundary]) {
      const markerFrom = lineFrom + leading;
      ranges.push({
        from: lineFrom,
        to: lineTo,
        markerFrom,
        markerTo: markerFrom + trimmed.length,
        sectionId: parsed.sectionId,
        boundary: parsed.boundary,
      });
    }
    if (newline === -1) break;
    lineFrom = newline + 1;
  }
  return ranges;
}

export function readMarkedSection(content: string, sectionId: string): string | null {
  const inspection = inspectMarkedSection(content, sectionId);
  return inspection.status === "present"
    ? content.slice(inspection.contentStart, inspection.contentEnd)
    : null;
}

export function replaceMarkedSection(
  content: string,
  sectionId: string,
  replacement: string,
): SectionUpdateResult {
  const inspection = inspectMarkedSection(content, sectionId);
  if (inspection.status !== "present") {
    return {
      ok: false,
      code: inspection.code,
      reason: inspection.reason,
    };
  }

  const markers = sectionMarkers(sectionId);
  const lineEnding = preferredLineEnding(content);
  const normalized = normalizeSectionBody(replacement, lineEnding);
  const next = `${content.slice(0, inspection.start)}${markers.start}${lineEnding}${quoteHead(normalized, lineEnding)}${normalized}${quoteTail(normalized, lineEnding)}${lineEnding}${markers.end}${content.slice(inspection.end + markers.end.length)}`;
  return { ok: true, content: next, changed: next !== content };
}

/**
 * A blank line between quote-ending content and the end marker. A blockquote
 * or callout would otherwise swallow the marker line into its rendered block
 * in live preview, hiding it. Reads trim the edge newlines away again, so
 * every write re-derives this and the framing stays stable byte for byte.
 */
function quoteTail(body: string, lineEnding: "\n" | "\r\n"): string {
  const lastLine = body.slice(body.lastIndexOf("\n") + 1);
  return lastLine.trimStart().startsWith(">") ? lineEnding : "";
}

/** The matching blank line after the start marker, so the framing reads even. */
function quoteHead(body: string, lineEnding: "\n" | "\r\n"): string {
  const newline = body.indexOf("\n");
  const firstLine = newline === -1 ? body : body.slice(0, newline);
  return firstLine.trimStart().startsWith(">") ? lineEnding : "";
}

export interface SectionLayoutEntry {
  id: string;
  heading: string;
}

/**
 * Inserts a managed section a note does not carry yet, at its canonical place
 * in the given layout: after the closest earlier section that exists, else
 * above the closest later one together with the heading sitting directly on
 * it, else after the note's first heading line. `layout` lists every section
 * the document may carry, in note order, with the heading each is created
 * under; `bodyStart` is where the frontmatter ends, so a heading inside YAML
 * can never anchor the insertion.
 */
export function insertMarkedSection(
  content: string,
  layout: readonly SectionLayoutEntry[],
  sectionId: string,
  value: string,
  bodyStart = 0,
): string {
  const entryIndex = layout.findIndex((entry) => entry.id === sectionId);
  if (entryIndex < 0) {
    throw new Error(`Section "${sectionId}" is not part of the layout.`);
  }
  const lineEnding = preferredLineEnding(content);
  const heading = layout[entryIndex]!.heading;
  const rendered = renderMarkedSectionWithEol(sectionId, value, lineEnding);
  const chunk =
    heading.length > 0
      ? `${heading}${lineEnding}${lineEnding}${rendered}`
      : rendered;
  const gap = `${lineEnding}${lineEnding}`;

  const present = layout
    .map((entry, index) => ({
      index,
      inspection: inspectMarkedSection(content, entry.id),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        index: number;
        inspection: Extract<ManagedSectionHealth, { status: "present" }>;
      } => candidate.inspection.status === "present",
    );

  const anchorBefore = [...present]
    .reverse()
    .find((candidate) => candidate.index < entryIndex);
  if (anchorBefore) {
    const endMarker = sectionMarkers(layout[anchorBefore.index]!.id).end;
    const insertAt = anchorBefore.inspection.end + endMarker.length;
    return `${content.slice(0, insertAt)}${gap}${chunk}${content.slice(insertAt)}`;
  }

  const anchorAfter = present.find((candidate) => candidate.index > entryIndex);
  if (anchorAfter) {
    const insertAt = blockStartAbove(content, anchorAfter.inspection.start);
    return `${content.slice(0, insertAt)}${chunk}${gap}${content.slice(insertAt)}`;
  }

  const body = content.slice(bodyStart);
  const title = /^#[ \t][^\r\n]*/mu.exec(body);
  if (title) {
    const insertAt = bodyStart + title.index + title[0].length;
    return `${content.slice(0, insertAt)}${gap}${chunk}${content.slice(insertAt)}`;
  }
  return body.trim().length > 0
    ? `${content.slice(0, bodyStart)}${chunk}${gap}${body}`
    : `${content.slice(0, bodyStart)}${chunk}${lineEnding}`;
}

/**
 * Removes a managed section outright: markers, content, and the heading
 * directly above it when that heading exactly matches one of the given
 * strings. Written for migration, which retires a legacy section after its
 * value moved into the frontmatter. Any other heading is someone's own line
 * and stays. Returns the content unchanged when the section is not cleanly
 * present.
 */
export function removeMarkedSection(
  content: string,
  sectionId: string,
  absorbHeadings: readonly string[] = [],
): string {
  const inspection = inspectMarkedSection(content, sectionId);
  if (inspection.status !== "present") return content;
  const endMarker = sectionMarkers(sectionId).end;

  let from = content.lastIndexOf("\n", Math.max(0, inspection.start - 1)) + 1;
  const known = new Set(absorbHeadings.map((heading) => heading.trim()));
  let probe = from;
  while (probe > 0) {
    const previousStart = content.lastIndexOf("\n", probe - 2) + 1;
    const previousLine = content
      .slice(previousStart, probe)
      .replace(/\r?\n$/u, "");
    if (previousLine.trim().length === 0) {
      probe = previousStart;
      continue;
    }
    if (known.has(previousLine.trim())) from = previousStart;
    break;
  }

  let to = inspection.end + endMarker.length;
  if (content.slice(to, to + 2) === "\r\n") to += 2;
  else if (content[to] === "\n") to += 1;

  const before = content.slice(0, from);
  const after = content.slice(to);
  const lineEnding = preferredLineEnding(content);
  const gap = `${lineEnding}${lineEnding}`;
  // The section carried the separation between its neighbours away with it;
  // give one blank line back where text remains on both sides.
  if (before.length > 0 && after.trim().length > 0) {
    const trimmedBefore = before.replace(/(?:\r\n|\r|\n)+$/u, "");
    const trimmedAfter = after.replace(/^(?:\r\n|\r|\n)+/u, "");
    return `${trimmedBefore}${gap}${trimmedAfter}`;
  }
  return `${before}${after.replace(/^(?:\r\n|\r|\n)+/u, "")}`;
}

/**
 * Where a section's block begins for something inserted above it: the start
 * of its marker line, or of the heading that sits directly on it with nothing
 * but blank lines between.
 */
function blockStartAbove(content: string, markerFrom: number): number {
  const markerLineStart =
    content.lastIndexOf("\n", Math.max(0, markerFrom - 1)) + 1;
  let cursor = markerLineStart;
  // Look upward across blank lines for a heading, but commit to its line only
  // when one is there: moving into a blank run that leads anywhere else would
  // strand the insertion between paragraphs.
  let probe = markerLineStart;
  while (probe > 0) {
    const previousStart = content.lastIndexOf("\n", probe - 2) + 1;
    const previousLine = content
      .slice(previousStart, probe)
      .replace(/\r?\n$/u, "");
    if (previousLine.trim().length === 0) {
      probe = previousStart;
      continue;
    }
    if (/^#{1,6}[ \t]/u.test(previousLine.trim())) cursor = previousStart;
    break;
  }
  return cursor;
}

function renderMarkedSectionWithEol(
  sectionId: string,
  initialContent: string,
  lineEnding: "\n" | "\r\n",
): string {
  const markers = sectionMarkers(sectionId);
  const body = normalizeSectionBody(initialContent, lineEnding);
  return `${markers.start}${lineEnding}${quoteHead(body, lineEnding)}${body}${quoteTail(body, lineEnding)}${lineEnding}${markers.end}`;
}

function normalizeSectionBody(
  value: string,
  lineEnding: "\n" | "\r\n",
): string {
  const trimmed = value.replace(/^(?:\r\n|\r|\n)+|(?:\r\n|\r|\n)+$/gu, "");
  return normalizeLineEndings(trimmed, lineEnding);
}

function normalizeLineEndings(
  value: string,
  lineEnding: "\n" | "\r\n",
): string {
  return value.replace(/\r\n|\r|\n/gu, lineEnding);
}

function preferredLineEnding(value: string): "\n" | "\r\n" {
  const firstNewline = value.indexOf("\n");
  return firstNewline > 0 && value[firstNewline - 1] === "\r" ? "\r\n" : "\n";
}

function invalidHealth(
  sectionId: string,
  code: Extract<ManagedSectionHealth, { status: "invalid" }>["code"],
  reason: string,
  path: string | null,
): ManagedSectionHealth {
  return { status: "invalid", path, sectionId, code, reason };
}

function scanMarkerOccurrences(content: string): MarkerOccurrence[] {
  return Array.from(content.matchAll(MARKER_LIKE_PATTERN), (match) => {
    const raw = match[0];
    const from = match.index;
    const parsed = parseTolerantMarker(raw);
    const fallbackSectionId =
      TOLERANT_SECTION_ID_PATTERN.exec(raw)?.[1]?.toLowerCase() ?? null;
    const sectionId = parsed?.sectionId ?? fallbackSectionId;
    const boundary = parsed?.boundary ?? null;
    const lineStart = content.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
    const nextNewline = content.indexOf("\n", from + raw.length);
    const lineEnd = nextNewline === -1 ? content.length : nextNewline;
    const line = content.slice(lineStart, lineEnd).replace(/\r$/u, "");
    return {
      raw,
      from,
      to: from + raw.length,
      sectionId,
      boundary,
      canonical:
        parsed !== null &&
        raw === sectionMarkers(parsed.sectionId)[parsed.boundary] &&
        line.trim() === raw,
    };
  });
}

function parseTolerantMarker(
  raw: string,
): { sectionId: string; boundary: MarkerBoundary } | null {
  const match = TOLERANT_MARKER_PATTERN.exec(raw);
  const sectionId = match?.[1];
  const boundary = match?.[2]?.toLowerCase();
  if (
    sectionId === undefined ||
    (boundary !== "start" && boundary !== "end")
  ) {
    return null;
  }
  // The tolerant pattern is case-insensitive and Unicode-aware, so its id class
  // also admits characters that fold into a-z without lowercasing into it --
  // U+017F LATIN SMALL LETTER LONG S among them. Rejecting them here keeps
  // every parsed id safe to hand to sectionMarkers(), which is strict ASCII and
  // throws; it runs inside the editor's transaction filter, where it must not.
  const normalized = sectionId.toLowerCase();
  return SECTION_ID_PATTERN.test(normalized)
    ? { sectionId: normalized, boundary }
    : null;
}

function pushUniqueIssue(
  issues: ManagedMarkerIssue[],
  issue: ManagedMarkerIssue,
): void {
  const existing = issues.find(
    (candidate) =>
      candidate.code === issue.code &&
      candidate.sectionId === issue.sectionId &&
      candidate.relatedSectionId === issue.relatedSectionId,
  );
  if (existing) {
    if (existing.from === undefined && issue.from !== undefined) {
      existing.from = issue.from;
    }
    if (existing.to === undefined && issue.to !== undefined) {
      existing.to = issue.to;
    }
    return;
  }
  issues.push(issue);
}
