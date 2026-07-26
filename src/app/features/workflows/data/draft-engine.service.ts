import { Injectable, inject } from '@angular/core';
import { Observable, catchError, defer, firstValueFrom, from, map, of } from 'rxjs';
import { ParseOptions, ParseResult, parseInstruction } from '../../../core/nlParser';
import { BrainContextSnapshot } from '../../../brain/context';
import { AiParseTransport, BrainClock } from '../../../brain/ports';
import {
  DEFAULT_ATTEMPT_TIMEOUT_MS,
  DEFAULT_TOTAL_DEADLINE_MS,
  hybridParse,
} from '../../../brain/orchestrator';
import { reviewCandidate } from '../../../brain/candidateNormalization';
import { makeCorrelationId } from '../../../brain/observability';
import { ApiService } from '../../../shared/api.service';
import { APP_CONFIG, isMockMode } from '../../../shared/app-config';
import { WORKFLOW_BRAIN_CONTEXT } from './workflow-brain-context.token';

/**
 * Natural-language instruction → {@link ParseResult}, hybrid-engine first.
 *
 * Live: routes the instruction through the Workflow Brain's hybrid
 * orchestration — deterministic parse first; only when gaps remain does the
 * admin console's AI parser run (`POST workflows/parse-ai` through
 * {@link ApiService}, carrying the `x-organization` tenancy contract, provider
 * keys server-side only). The backend's answer is treated as UNTRUSTED INPUT:
 * `reviewCandidate` re-runs shape/bounds checks, key allowlists, entity
 * re-grounding against the context snapshot, URL screening, model-disarm, and
 * clause-coverage comparison CLIENT-SIDE before anything reaches the composer.
 * A candidate that fails review degrades to the deterministic parse with an
 * honest `fallbackReason` — so even a compromised or drifted backend cannot
 * plant an ungrounded rule.
 *
 * Fallback: mock mode (no live credentials) OR any transport/review failure
 * yields the local, deterministic {@link parseInstruction}. Mock mode is
 * byte-for-byte unchanged. Same-keystroke live preview does NOT come through
 * here — it stays on the deterministic parser (no round-trips while typing).
 *
 * The context snapshot arrives through {@link WORKFLOW_BRAIN_CONTEXT}: the
 * standalone adapter here, the Landjourney live adapter after transplant — the
 * pipeline itself never changes (the transplant manifest's wiring seam).
 */
@Injectable({ providedIn: 'root' })
export class DraftEngineService {
  private readonly api = inject(ApiService);
  private readonly config = inject(APP_CONFIG);
  private readonly provider = inject(WORKFLOW_BRAIN_CONTEXT);

  /** Angular layer owns real time; the Brain only ever sees this port. */
  private readonly clock: BrainClock = { now: () => Date.now() };
  private requestCounter = 0;
  private snapshotPromise: Promise<BrainContextSnapshot> | null = null;

  draft(instruction: string, opts?: ParseOptions): Observable<ParseResult> {
    const text = instruction.trim();
    if (!text || isMockMode(this.config)) {
      return of(parseInstruction(text, opts));
    }
    return defer(() => from(this.hybridDraft(text, opts))).pipe(
      map((res) => (isParseResult(res) ? res : parseInstruction(text, opts))),
      catchError(() => of(parseInstruction(text, opts))),
    );
  }

  private async hybridDraft(text: string, opts?: ParseOptions): Promise<ParseResult> {
    const snapshot = await this.snapshot();
    return hybridParse(
      {
        text,
        snapshot,
        // Description generations live in the composer/brain; this seam only
        // stamps provenance. Staleness is enforced by the composer's
        // buildGeneration guard and the brain's content comparison.
        generation: 0,
        requestId: makeCorrelationId(this.clock, () => ++this.requestCounter),
        baseOptions: opts,
        attemptTimeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
        totalDeadlineMs: DEFAULT_TOTAL_DEADLINE_MS,
      },
      {
        review: reviewCandidate,
        deterministicParse: (t, o) => parseInstruction(t, o),
        clock: this.clock,
        transport: this.transport(),
      },
    );
  }

  /**
   * Memoized on SUCCESS only: a transient provider failure on the first Build
   * must not pin every later live draft to the deterministic parser for the
   * page's lifetime (focused-review P2 — reachable once the Landjourney live
   * adapter is wired). Rejections clear the memo so the next draft retries.
   */
  private snapshot(): Promise<BrainContextSnapshot> {
    this.snapshotPromise ??= this.provider
      .getSnapshot({ profile: this.provider.profile, purpose: 'parse' })
      .catch((error: unknown) => {
        this.snapshotPromise = null;
        throw error;
      });
    return this.snapshotPromise;
  }

  /**
   * The wire contract is unchanged: `{ text, options }` in, a ParseResult-shaped
   * candidate out — which the orchestrator hands straight to review as hostile.
   * The orchestrator races its own deadline; an abandoned HTTP response is
   * simply discarded (HttpClient has no mid-flight cancel at this seam).
   */
  private transport(): AiParseTransport {
    return {
      parse: async (request) => ({
        candidate: await firstValueFrom(
          this.api.post<unknown>('workflows', '/parse-ai', {
            text: request.text,
            options: request.options,
            // Present only on the single bounded structural-repair attempt —
            // without it the repair POST was byte-identical to attempt 1
            // (focused-review P2; backend contract §Request accepts it).
            ...(request.repairHint ? { repairHint: request.repairHint } : {}),
          }),
        ),
      }),
    };
  }
}

/** Trust the payload only if it satisfies the `ParseResult` contract. */
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
