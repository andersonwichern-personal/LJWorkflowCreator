/**
 * Phase 8 (§12): optimistic-concurrency primitives shared by services + routes.
 *
 * Services throw VersionConflictError when a guarded conditional write matches
 * zero rows (the record moved underneath the editor); routes translate it into
 * an HTTP 409 carrying the server's current record so the client can offer
 * "view theirs / overwrite anyway / reload" — no silent last-write-wins.
 */

export class VersionConflictError extends Error {
  constructor(
    public readonly currentVersion: number,
    public readonly current: unknown
  ) {
    super(
      `Record was modified by someone else (server version ${currentVersion}) — reload or overwrite explicitly`
    );
    this.name = "VersionConflictError";
  }
}

/** 409 payload shape shared by every guarded route. */
export function conflictPayload(err: VersionConflictError): {
  error: string;
  conflict: true;
  currentVersion: number;
  current: unknown;
} {
  return {
    error: err.message,
    conflict: true,
    currentVersion: err.currentVersion,
    current: err.current,
  };
}

export function isVersionConflict(err: unknown): err is VersionConflictError {
  return err instanceof VersionConflictError;
}
