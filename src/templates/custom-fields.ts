import { foldName } from "../domain";
import { SECTION_MARKER_PREFIX } from "./markers";

/**
 * The custom-fields block: the one region of a member note the form's field
 * rows read and write. It lives in its own marked section after the note's
 * prose section, so nothing here ever reads the author's prose — an H3 the
 * author wrote under "Notes" is theirs, and only headings inside this block
 * are fields.
 *
 * Parsing is positional and lossless. Every `###` heading opens a field and
 * carries everything up to the next one; text standing before the first
 * heading — which only a hand edit can put there — is kept aside verbatim and
 * re-emitted, never shown as a field and never dropped. Duplicate titles load
 * as separate rows; the form is where uniqueness is enforced, at the one door
 * writes pass through.
 */

export interface CustomField {
  title: string;
  content: string;
}

export interface CustomFieldsBlock {
  /** Text before the first heading, hand-written; preserved, never a field. */
  leading: string;
  fields: CustomField[];
}

const FIELD_HEADING_PATTERN = /^###\s+(?<title>\S.*?)\s*$/u;

interface RawField extends CustomField {
  /** The exact slice of the block, heading line through the next heading. */
  raw: string;
}

function parseRawFields(block: string): { leading: string; fields: RawField[] } {
  const lines = block.split("\n");
  const headingIndexes: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (FIELD_HEADING_PATTERN.test(lines[index]!)) headingIndexes.push(index);
  }
  if (headingIndexes.length === 0) {
    return { leading: block, fields: [] };
  }
  const leading = lines.slice(0, headingIndexes[0]).join("\n");
  const fields: RawField[] = [];
  headingIndexes.forEach((headingIndex, position) => {
    const end = headingIndexes[position + 1] ?? lines.length;
    const slice = lines.slice(headingIndex, end);
    const title =
      FIELD_HEADING_PATTERN.exec(lines[headingIndex]!)?.groups?.["title"] ?? "";
    fields.push({
      title,
      content: trimBlankEdges(slice.slice(1).join("\n")),
      raw: slice.join("\n"),
    });
  });
  return { leading, fields };
}

export function parseCustomFields(block: string): CustomFieldsBlock {
  const { leading, fields } = parseRawFields(block);
  return {
    leading,
    fields: fields.map(({ title, content }) => ({ title, content })),
  };
}

/**
 * The block to store for a set of field rows. A save that changes nothing
 * returns the original byte for byte. A save that does change something
 * renders the changed rows in the canonical shape and keeps every untouched
 * row's own text — matched by title and content, consumed in order so
 * duplicate titles pair up positionally — with blocks joined by one blank
 * line. Zero fields with nothing hand-written serialize to the empty string,
 * which is how the section stays absent.
 */
export function serializeCustomFields(
  original: string,
  fields: readonly CustomField[],
): string {
  const parsed = parseRawFields(original);
  if (
    fields.length === parsed.fields.length &&
    fields.every(
      (field, index) =>
        field.title === parsed.fields[index]!.title &&
        field.content === parsed.fields[index]!.content,
    )
  ) {
    return original;
  }
  const unclaimed = [...parsed.fields];
  const blocks = fields.map((field) => {
    const match = unclaimed.findIndex(
      (candidate) =>
        candidate.title === field.title && candidate.content === field.content,
    );
    if (match >= 0) {
      const kept = unclaimed.splice(match, 1)[0]!;
      return trimBlankEdges(kept.raw);
    }
    const title = field.title.trim();
    const content = trimBlankEdges(field.content);
    return content.length > 0 ? `### ${title}\n\n${content}` : `### ${title}`;
  });
  const leading = trimBlankEdges(parsed.leading);
  return [...(leading.length > 0 ? [leading] : []), ...blocks].join("\n\n");
}

/** The first title said twice under fold, or null while every title is its own. */
export function duplicateFieldTitle(
  titles: readonly string[],
): string | null {
  const seen = new Set<string>();
  for (const title of titles) {
    const folded = foldName(title.trim());
    if (folded.length === 0) continue;
    if (seen.has(folded)) return title.trim();
    seen.add(folded);
  }
  return null;
}

const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u;
const MARKED_RANGE_PATTERN = new RegExp(
  `<!--\\s*${SECTION_MARKER_PREFIX}:[^\\r\\n]*?:start\\s*-->[\\s\\S]*?<!--\\s*${SECTION_MARKER_PREFIX}:[^\\r\\n]*?:end\\s*-->`,
  "gu",
);
const STRAY_MARKER_PATTERN = new RegExp(
  `<!--[^\\r\\n]*?${SECTION_MARKER_PREFIX}[^\\r\\n]*?-->`,
  "gu",
);

/**
 * The default fields a template note defines: every `###` block of its body,
 * frontmatter and managed ranges left out. The note was chosen as a template,
 * so its headings are the point; prose between them belongs to the block
 * above it, prose before the first is the note talking to its reader, and a
 * repeated title counts once, first spelling wins.
 */
export function templateCustomFields(noteContent: string): CustomField[] {
  const body = noteContent
    .replace(FRONTMATTER_PATTERN, "")
    .replace(MARKED_RANGE_PATTERN, "")
    .replace(STRAY_MARKER_PATTERN, "");
  const { fields } = parseRawFields(body);
  const seen = new Set<string>();
  const defaults: CustomField[] = [];
  for (const field of fields) {
    const folded = foldName(field.title);
    if (seen.has(folded)) continue;
    seen.add(folded);
    defaults.push({ title: field.title, content: field.content });
  }
  return defaults;
}

function trimBlankEdges(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/u, "").replace(/\s+$/u, "");
}
