import { Injectable, inject, signal } from '@angular/core';
import { BrainContextSnapshot } from '../../../brain/context';
import {
  GhostRequestState,
  GhostSuggestion,
  deterministicGhost,
  ghostPolicy,
  makeGhostDismissals,
} from '../../../brain/ghostSuggestions';
import { WORKFLOW_BRAIN_CONTEXT } from './workflow-brain-context.token';

/** What the composer knows about its own input state on each render. */
export interface GhostComposerState {
  text: string;
  cursorStart: number;
  cursorEnd: number;
  generation: number;
  ruleVersion: number;
  imeComposing: boolean;
}

/**
 * Ghost-autowriting host service — DETERMINISTIC-ONLY this wave.
 *
 * No live ghost endpoint exists, so the AI ghost port stays unwired and the
 * capability is pinned false (fail closed per HostCapabilityPort semantics):
 * ghostPolicy can never choose the AI path, no transport is injected, and this
 * service makes ZERO network calls — no API client import of any kind.
 * Suggestions come from deterministicGhost over the standalone context
 * snapshot (pure CPU, safe to run per keystroke), gated by ghostPolicy and an
 * in-memory, generation-scoped dismissal memory (Esc'd ghosts are not
 * re-offered for the same prefix; the next keystroke forgets them).
 */
@Injectable({ providedIn: 'root' })
export class GhostSuggestionService {
  private readonly provider = inject(WORKFLOW_BRAIN_CONTEXT);
  private readonly snapshotSignal = signal<BrainContextSnapshot | null>(null);
  /** Bumped on dismiss so computed callers re-evaluate and hide the ghost. */
  private readonly dismissalVersion = signal(0);
  private readonly dismissals = makeGhostDismissals();

  constructor() {
    // Local, deterministic snapshot compile — resolves on the microtask queue.
    void this.provider
      .getSnapshot({ profile: this.provider.profile, purpose: 'ghost-suggest' })
      .then((snapshot) => this.snapshotSignal.set(snapshot));
  }

  /**
   * The current ghost for the composer state, or null when policy suppresses,
   * nothing safe exists, or the author dismissed this exact suggestion.
   * Pure read — safe inside a computed().
   */
  suggest(state: GhostComposerState): GhostSuggestion | null {
    this.dismissalVersion();
    const snapshot = this.snapshotSignal();
    if (!snapshot) return null;
    const request: GhostRequestState = {
      ...state,
      contextSnapshotId: snapshot.snapshotId,
      // Fail closed: the AI ghost transport is not wired in this host.
      aiCapability: false,
      recentRateLimit: false,
      offline: false,
    };
    const deterministic = deterministicGhost(request, snapshot);
    const decision = ghostPolicy(request, deterministic);
    if (!decision.allow || deterministic === null) return null;
    this.dismissals.clearBefore(state.generation);
    if (this.dismissals.has(deterministic.prefixHash, deterministic.insertText)) return null;
    return deterministic;
  }

  /** Esc: remember (prefix, insertText) for the suggestion's generation. */
  dismiss(suggestion: GhostSuggestion): void {
    this.dismissals.add(suggestion.prefixHash, suggestion.insertText, suggestion.generation);
    this.dismissalVersion.update((version) => version + 1);
  }

  /** Telemetry hook — deliberately a no-op until a telemetry sink is wired. */
  accepted(_suggestion: GhostSuggestion): void {}
}
