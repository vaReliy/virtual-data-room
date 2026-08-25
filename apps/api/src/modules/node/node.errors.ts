/**
 * A name already taken in the destination folder, raised by the repository and turned
 * into a `409` by the service.
 *
 * It exists so the repository does not import `@nestjs/common` exceptions and the service
 * does not have to recognise a Postgres SQLSTATE. The translation happens once, at the
 * boundary between them — which is also the only place that knows whether this operation
 * auto-suffixes (upload, Phase 3) or refuses (create and rename, decision #20).
 */
export class NameConflictError extends Error {
  constructor(readonly conflictingName: string) {
    super(`A node named "${conflictingName}" already exists in this folder.`);
    // Not `name`: that property is the error's own class name, and shadowing it here
    // would make every log line report the folder name as the error type.
    this.name = 'NameConflictError';
  }
}
