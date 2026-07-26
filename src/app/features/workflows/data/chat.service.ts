import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { BrainContextSnapshot } from '../../../brain/context';
import {
  ConversationMessage,
  ConversationTurnResult,
  converse,
} from '../../../brain/conversation';
import { BrainClock, ConversationTransport } from '../../../brain/ports';
import { ACTIONS, EVENTS } from '../../../core/vocabulary';
import { ApiService } from '../../../shared/api.service';
import { APP_CONFIG } from '../../../shared/app-config';
import { WORKFLOW_BRAIN_CONTEXT } from './workflow-brain-context.token';

/** Caps on the vocabulary hints sent with a chat turn — context, not payload. */
const MAX_VOCAB_EVENTS = 32;
const MAX_VOCAB_ACTIONS = 32;
const MAX_VOCAB_ASSIGNEES = 20;

/**
 * Conversational turns for the composer, via the Brain's conversation lane
 * (modeled on {@link DraftEngineService}). The Angular layer owns all I/O and
 * real time; the Brain's `converse` owns policy: transport racing, the
 * hostile-reply review, and the deterministic fallback.
 *
 * Live: when `config.aiBase` is set, one turn is `POST <aiBase>/workflows/chat`
 * through {@link ApiService} (same-origin serverless function fronting the
 * Gemini backend — provider keys server-side only). The reply is UNTRUSTED
 * INPUT: `converse` runs it through `reviewChatReply` (control/zero-width
 * stripping, non-empty, 4000-char clamp) before anything reaches the thread.
 *
 * Fallback: no `aiBase`, an HTTP error, a timeout, or a rejected reply all
 * degrade to the Brain's `deterministicReply` — grounded in the SAME context
 * snapshot the parser uses, so mock/offline mode answers fully with zero
 * configuration and never pretends a model responded.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly api = inject(ApiService);
  private readonly config = inject(APP_CONFIG);
  private readonly provider = inject(WORKFLOW_BRAIN_CONTEXT);

  /** Angular layer owns real time; the Brain only ever sees this port. */
  private readonly clock: BrainClock = { now: () => Date.now() };
  private snapshotPromise: Promise<BrainContextSnapshot> | null = null;

  /**
   * One conversational turn over the FULL thread (multi-turn context). Never
   * rejects in normal operation: every transport failure becomes an honest
   * deterministic result (`source: "deterministic"` + `fallbackReason`).
   */
  async send(messages: ConversationMessage[]): Promise<ConversationTurnResult> {
    const snapshot = await this.snapshot().catch(() => null);
    return converse(
      {
        messages,
        contextSnapshotId: snapshot?.snapshotId,
        requestId: crypto.randomUUID(),
      },
      {
        transport: this.config.aiBase ? this.transport(snapshot) : undefined,
        clock: this.clock,
        snapshot,
      },
    );
  }

  /** One snapshot per service lifetime — the provider's versioning governs freshness. */
  private snapshot(): Promise<BrainContextSnapshot> {
    this.snapshotPromise ??= this.provider.getSnapshot({
      profile: this.provider.profile,
      purpose: 'consult',
    });
    return this.snapshotPromise;
  }

  /**
   * The wire contract: `{ messages, vocabulary }` in, `{ reply, meta }` out —
   * `reply` handed straight to `converse`'s review as hostile. The capped
   * vocabulary lists ground the backend prompt in what this tenant can
   * actually automate. Any HTTP error propagates as a throw so `converse`
   * falls back deterministically; `converse` races its own deadline (an
   * abandoned HTTP response is simply discarded at this seam).
   */
  private transport(snapshot: BrainContextSnapshot | null): ConversationTransport {
    return {
      chat: async (request) => {
        const response = await firstValueFrom(
          this.api.postAi<{ reply?: unknown; meta?: { provider?: string; model?: string; latencyMs?: number } }>(
            '/chat',
            {
              messages: request.messages,
              vocabulary: {
                events: EVENTS.map((event) => event.key).slice(0, MAX_VOCAB_EVENTS),
                actions: ACTIONS.map((action) => action.label).slice(0, MAX_VOCAB_ACTIONS),
                assignees: (snapshot?.assignees ?? []).slice(0, MAX_VOCAB_ASSIGNEES),
              },
            },
          ),
        );
        return { reply: response?.reply, meta: response?.meta };
      },
    };
  }
}
