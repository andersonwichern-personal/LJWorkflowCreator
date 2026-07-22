import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { ParseOptions, ParseResult, parseInstruction } from '../../../core/nlParser';
import { ApiService } from '../../../shared/api.service';
import { APP_CONFIG, isMockMode } from '../../../shared/app-config';

/**
 * Natural-language instruction → {@link ParseResult}, real-AI first.
 *
 * Live: routes the instruction to the admin console's AI parser
 * (`POST workflows/parse-ai` through {@link ApiService}, carrying the
 * `x-organization` tenancy contract). That backend fronts the Cloudflare AI
 * Gateway server-side (the Cloudflare token + provider key never reach the
 * browser) and MUST return the SAME `ParseResult` shape the deterministic
 * parser produces.
 *
 * Fallback: mock mode (no live credentials) OR any transport/shape failure
 * degrades to the local, deterministic {@link parseInstruction}. So the
 * composer never blocks on a model outage, and mock mode is byte-for-byte
 * unchanged. rule-core stays pure — the network call lives here, never in
 * `core/nlParser` (which the purity gate pins).
 *
 * Same-keystroke live preview does NOT come through here — it stays on the
 * deterministic parser so typing costs no round-trips or tokens.
 */
@Injectable({ providedIn: 'root' })
export class DraftEngineService {
  private readonly api = inject(ApiService);
  private readonly config = inject(APP_CONFIG);

  draft(instruction: string, opts?: ParseOptions): Observable<ParseResult> {
    const text = instruction.trim();
    if (!text || isMockMode(this.config)) {
      return of(parseInstruction(text, opts));
    }
    // `options` carries forceEvent + live vocab (assignees, instanceOptions,
    // instanceRegistry, allowUnbackedValues) so the backend can build the
    // same context the deterministic parser sees.
    return this.api
      .post<ParseResult>('workflows', '/parse-ai', { text, options: opts ?? {} })
      .pipe(
        map((res) => (isParseResult(res) ? res : parseInstruction(text, opts))),
        catchError(() => of(parseInstruction(text, opts))),
      );
  }
}

/** Trust the backend payload only if it satisfies the `ParseResult` contract. */
function isParseResult(value: unknown): value is ParseResult {
  const r = value as ParseResult | null;
  return (
    !!r &&
    (r.rule === null || (typeof r.rule === 'object' && r.rule !== undefined)) &&
    Array.isArray(r.notes) &&
    Array.isArray(r.unresolved) &&
    Array.isArray(r.uncovered) &&
    Array.isArray(r.ambiguities)
  );
}
