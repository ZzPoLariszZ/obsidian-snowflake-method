import { parseYaml } from "obsidian";

import { SCHEMA_VERSION, isWritableSchemaVersion } from "../domain";
import { InvalidManagedDocumentError, UnsupportedSchemaError } from "./errors";

export type FrontmatterValue = unknown;
export type ManagedFrontmatter = Record<string, FrontmatterValue>;

export interface ParsedMarkdown {
  frontmatter: ManagedFrontmatter;
  body: string;
  hasFrontmatter: boolean;
}

const FRONTMATTER_PATTERN = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseMarkdownFrontmatter(content: string): ParsedMarkdown {
  const match = FRONTMATTER_PATTERN.exec(content);
  if (!match) {
    return { frontmatter: {}, body: content, hasFrontmatter: false };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? "");
  } catch (error) {
    throw new InvalidManagedDocumentError(
      `Invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (parsed == null) parsed = {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidManagedDocumentError("Frontmatter must be a YAML mapping.");
  }

  return {
    frontmatter: parsed as ManagedFrontmatter,
    body: content.slice(match[0].length),
    hasFrontmatter: true,
  };
}

/**
 * The keys of `order` a note actually carries, in the order it carries them.
 * Everything else the note holds is left out: an author's own property has no
 * place in this sequence and no business disturbing it.
 */
function orderedKeysOf(
  frontmatter: ManagedFrontmatter,
  order: readonly string[],
): string[] {
  const named = new Set(order);
  return Object.keys(frontmatter).filter((key) => named.has(key));
}

/** Whether the keys `order` names already read in that order. */
export function isFrontmatterOrdered(
  frontmatter: ManagedFrontmatter,
  order: readonly string[],
): boolean {
  const present = orderedKeysOf(frontmatter, order);
  const wanted = order.filter((key) =>
    Object.prototype.hasOwnProperty.call(frontmatter, key),
  );
  return present.every((key, at) => key === wanted[at]);
}

/**
 * Rewrites a mapping in place so the keys `order` names read in that order.
 * Keys it does not name follow, in the sequence they already had.
 */
export function orderFrontmatterKeys(
  frontmatter: ManagedFrontmatter,
  order: readonly string[],
): void {
  if (isFrontmatterOrdered(frontmatter, order)) return;
  const named = new Set(order);
  const values = { ...frontmatter };
  const sorted = [
    ...order.filter((key) =>
      Object.prototype.hasOwnProperty.call(frontmatter, key),
    ),
    ...Object.keys(frontmatter).filter((key) => !named.has(key)),
  ];
  for (const key of Object.keys(frontmatter)) delete frontmatter[key];
  for (const key of sorted) frontmatter[key] = values[key];
}

export function schemaVersionOf(frontmatter: ManagedFrontmatter): number | null {
  const raw = frontmatter["snowflake-schema"];
  if (raw == null || raw === "") return null;
  const numeric = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

/**
 * Whether a note declares a schema this build cannot write.
 *
 * A note carrying no schema at all is not one of ours and is not locked; one
 * carrying a schema we do not recognise is a note a later build wrote, and is
 * read but never written back. Anything in the supported range stays writable:
 * schema 1 notes keep working through their legacy keys until the user runs
 * the migration.
 */
export function isReadOnlySchema(frontmatter: ManagedFrontmatter): boolean {
  return (
    Object.prototype.hasOwnProperty.call(frontmatter, "snowflake-schema") &&
    !isWritableSchemaVersion(schemaVersionOf(frontmatter))
  );
}

export function assertWritableSchema(path: string, frontmatter: ManagedFrontmatter): void {
  if (!Object.prototype.hasOwnProperty.call(frontmatter, 'snowflake-schema')) {
    return;
  }
  const schema = schemaVersionOf(frontmatter);
  if (schema === null) {
    throw new InvalidManagedDocumentError(
      `Invalid Snowflake schema in "${path}".`,
      path,
    );
  }
  if (!isWritableSchemaVersion(schema)) {
    throw new UnsupportedSchemaError(path, schema, SCHEMA_VERSION);
  }
}

export function isManagedFrontmatter(frontmatter: ManagedFrontmatter): boolean {
  return (
    schemaVersionOf(frontmatter) != null &&
    typeof frontmatter["snowflake-document"] === "string" &&
    typeof frontmatter["snowflake-project-id"] === "string"
  );
}

export function documentTypeOf(frontmatter: ManagedFrontmatter): string | null {
  const value = frontmatter["snowflake-document"];
  return typeof value === "string" ? value : null;
}

export function projectIdOf(frontmatter: ManagedFrontmatter): string | null {
  const value = frontmatter["snowflake-project-id"];
  return typeof value === "string" && value.length > 0 ? value : null;
}
