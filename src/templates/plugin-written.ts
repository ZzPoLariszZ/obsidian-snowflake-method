import {
  PROTECTED_SECTION_IDS,
  managedSectionsForDocument,
  type CountableRange,
  type DocumentType,
} from "../domain";
import { inspectMarkedSection } from "./markers";

/**
 * Where a body's plugin-written sections sit: the generated views and the
 * record storage, which the domain already names in one place. The writing
 * count and the manuscript analysis both ask this rather than re-deciding
 * what the plugin wrote, so no two readings of one note can disagree about
 * it. A note whose type is unknown excludes nothing: text that never was a
 * managed note has no plugin-written stretch to set aside.
 */
export function pluginWrittenRanges(
  body: string,
  documentType: DocumentType | null,
): CountableRange[] {
  const ranges: CountableRange[] = [];
  for (const descriptor of documentType === null
    ? []
    : managedSectionsForDocument(documentType)) {
    if (!PROTECTED_SECTION_IDS.has(descriptor.id)) continue;
    const inspection = inspectMarkedSection(body, descriptor.id);
    if (inspection.status !== "present") continue;
    ranges.push({
      from: inspection.contentStart,
      to: inspection.contentEnd,
    });
  }
  return ranges;
}
