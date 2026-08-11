import { readMarkedSection } from "../templates";

/**
 * The one generated section per member document: the read-only block that
 * displays the note's properties with localized labels.
 */
export const MEMBER_FIELDS_SECTION_BY_DOCUMENT = {
  character: "character-fields",
  scene: "scene-fields",
} as const;

export type MemberDocumentType = keyof typeof MEMBER_FIELDS_SECTION_BY_DOCUMENT;

export function isMemberDocumentType(
  value: string | null,
): value is MemberDocumentType {
  return value === "character" || value === "scene";
}

export interface FieldsBlockWrite {
  sectionId: string;
  value: string;
}

/**
 * Whether a note's fields block needs rewriting to say what the properties
 * say, and with what. The properties are the store and the block only a view
 * of them, so this is one-way and idempotent: no history, no merging, just
 * the rendered expectation against what the note carries.
 *
 * A note without the block is one the migration has not reached, and a note
 * whose markers are damaged reads the same way; neither is written here.
 * Migration inserts blocks, health reports damage, this only maintains.
 */
export function planFieldsBlockReconcile(options: {
  documentType: MemberDocumentType;
  content: string;
  expectedBlock: string;
}): FieldsBlockWrite | null {
  const sectionId = MEMBER_FIELDS_SECTION_BY_DOCUMENT[options.documentType];
  const actual = readMarkedSection(options.content, sectionId);
  if (actual === null) return null;
  if (comparable(actual) === comparable(options.expectedBlock)) return null;
  return { sectionId, value: options.expectedBlock };
}

/**
 * Writes through the section machinery normalize line endings to the file's
 * own, so a CRLF note holds a CRLF block that must still count as equal to
 * the LF expectation, or every pass would rewrite it again.
 */
function comparable(value: string): string {
  return value.replace(/\r\n|\r/gu, "\n").trim();
}
