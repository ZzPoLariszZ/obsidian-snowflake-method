export class RepositoryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "RepositoryError";
  }
}

export class PathConflictError extends RepositoryError {
  constructor(readonly path: string) {
    super(`A folder or file already occupies "${path}".`, "path-conflict");
    this.name = "PathConflictError";
  }
}

export class ManagedFileNotFoundError extends RepositoryError {
  constructor(readonly path: string) {
    super(`Managed Markdown file not found: "${path}".`, "managed-file-not-found");
    this.name = "ManagedFileNotFoundError";
  }
}

export class InvalidManagedDocumentError extends RepositoryError {
  constructor(message: string, readonly path?: string) {
    super(message, "invalid-managed-document");
    this.name = "InvalidManagedDocumentError";
  }
}

export class UnsupportedSchemaError extends RepositoryError {
  constructor(
    readonly path: string,
    readonly schemaVersion: number,
    readonly supportedVersion: number,
  ) {
    super(
      `"${path}" uses Snowflake schema ${schemaVersion}, but this plugin supports schema ${supportedVersion}. The file is read-only.`,
      "unsupported-schema",
    );
    this.name = "UnsupportedSchemaError";
  }
}

export class ConcurrentChangeError extends RepositoryError {
  constructor(
    readonly path: string,
    readonly expectedRevision: string,
    readonly actualRevision: string,
  ) {
    super(
      `The managed note changed after it was opened: "${path}". Review the latest version and try again.`,
      "concurrent-change",
    );
    this.name = "ConcurrentChangeError";
  }
}

export class UnsafeSectionError extends RepositoryError {
  constructor(readonly path: string, readonly sectionId: string, reason: string) {
    super(`Cannot safely update section "${sectionId}" in "${path}": ${reason}`, "unsafe-section");
    this.name = "UnsafeSectionError";
  }
}
