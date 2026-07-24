/**
 * brainState — deterministic session state machine of the Workflow Brain.
 *
 * Pure module: no host, no I/O, no wall-clock, no randomness. Time enters ONLY
 * through event payloads (`at`, epoch ms from the injected BrainClock port).
 * `reduceBrain` never mutates its input; callers may freeze states and replay
 * event logs to reproduce any session exactly.
 *
 * The ParseEnvelope import is TYPE-ONLY on purpose: the contract file is owned
 * by a sibling module and type-only keeps this module runtime-decoupled.
 */

import type { BrainContextSnapshot, ContextProfileId } from "./context";
import type { ParseEnvelope } from "../../rule-core/src/parserProvenance";

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

export type BrainPhase =
  | "discover"
  | "scope"
  | "draft"
  | "gaps"
  | "recommend"
  | "propose"
  | "consent"
  | "apply"
  | "verify"
  | "simulate"
  | "prepare";

export interface RecommendationRef {
  id: string;
  status: "open" | "accepted" | "rejected" | "expired";
  /** Snapshot the recommendation was computed against — mismatch = stale. */
  snapshotId: string;
  /** Rule version the recommendation was computed against — mismatch = stale. */
  ruleVersion: number;
}

export interface BrainHistoryEntry {
  at: number;
  kind: string;
  detail: string;
  generation: number;
  ruleVersion: number;
}

export interface BrainSessionState {
  profile: ContextProfileId;
  tenantKey: string;
  snapshotId: string | null;
  vocabularyHash: string | null;
  /** Description generation; a bump invalidates everything derived from it. */
  generation: number;
  /** Bumps on parse-completed and applied patches. */
  ruleVersion: number;
  phase: BrainPhase;
  description: string;
  envelope: ParseEnvelope | null;
  openQuestionIds: string[];
  recommendations: RecommendationRef[];
  /** Context-independent facts that SURVIVE a context switch (author goals, stated constraints). */
  acceptedFacts: string[];
  /** Append-only authoring history — entries are never rewritten or removed. */
  history: BrainHistoryEntry[];
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

export type BrainEvent =
  | { type: "context-attached"; snapshot: BrainContextSnapshot; at: number }
  | { type: "context-switched"; snapshot: BrainContextSnapshot; at: number }
  | { type: "description-changed"; description: string; at: number }
  | { type: "parse-completed"; envelope: ParseEnvelope; generation: number; at: number }
  | { type: "clarification-answered"; questionId: string; at: number }
  | { type: "recommendations-issued"; refs: RecommendationRef[]; at: number }
  | { type: "recommendation-accepted"; id: string; at: number }
  | { type: "recommendation-rejected"; id: string; at: number }
  | { type: "fact-recorded"; fact: string; at: number }
  | { type: "phase-advanced"; phase: BrainPhase; at: number };

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

export function initialBrainState(profile: ContextProfileId, tenantKey: string): BrainSessionState {
  return {
    profile,
    tenantKey,
    snapshotId: null,
    vocabularyHash: null,
    generation: 0,
    ruleVersion: 0,
    phase: "discover",
    description: "",
    envelope: null,
    openQuestionIds: [],
    recommendations: [],
    acceptedFacts: [],
    history: [],
  };
}

/* -------------------------------------------------------------------------- */
/* Reducer                                                                    */
/* -------------------------------------------------------------------------- */

/** Structural-sharing rebuild + the single history entry every event appends. */
function next(
  state: BrainSessionState,
  changes: Partial<Omit<BrainSessionState, "history">>,
  at: number,
  kind: string,
  detail: string
): BrainSessionState {
  const merged: BrainSessionState = { ...state, ...changes, history: state.history };
  return {
    ...merged,
    history: [
      ...state.history,
      { at, kind, detail, generation: merged.generation, ruleVersion: merged.ruleVersion },
    ],
  };
}

function expireOpen(refs: RecommendationRef[]): RecommendationRef[] {
  return refs.map((r) => (r.status === "open" ? { ...r, status: "expired" as const } : r));
}

/** A gap is any honesty sidecar the parse left non-empty — never overridable. */
function envelopeHasGaps(envelope: ParseEnvelope): boolean {
  return (
    (envelope.unresolved?.length ?? 0) > 0 ||
    (envelope.uncovered?.length ?? 0) > 0 ||
    (envelope.ambiguities?.length ?? 0) > 0
  );
}

/** Context switch invalidation. Tenant switch additionally wipes tenant memory. */
function applyContextSnapshot(
  state: BrainSessionState,
  snapshot: BrainContextSnapshot,
  at: number,
  kind: string
): BrainSessionState {
  const tenantChanged = snapshot.identity.tenantKey !== state.tenantKey;
  return next(
    state,
    {
      profile: snapshot.profile,
      tenantKey: snapshot.identity.tenantKey,
      snapshotId: snapshot.snapshotId,
      vocabularyHash: snapshot.vocabularyHash,
      envelope: null,
      openQuestionIds: [],
      // Tenant-specific memory must not survive a tenant switch; a same-tenant
      // context switch only expires what was derived from the old snapshot.
      recommendations: tenantChanged ? [] : expireOpen(state.recommendations),
      acceptedFacts: tenantChanged ? [] : state.acceptedFacts,
    },
    at,
    kind,
    tenantChanged
      ? `tenant switched to snapshot ${snapshot.snapshotId}`
      : `context switched to snapshot ${snapshot.snapshotId}`
  );
}

export function reduceBrain(state: BrainSessionState, event: BrainEvent): BrainSessionState {
  switch (event.type) {
    case "context-attached": {
      const sameContext =
        event.snapshot.identity.tenantKey === state.tenantKey &&
        event.snapshot.snapshotId === state.snapshotId;
      if (sameContext) {
        return next(state, {}, event.at, event.type, `context re-attached ${event.snapshot.snapshotId}`);
      }
      return applyContextSnapshot(state, event.snapshot, event.at, event.type);
    }

    case "context-switched":
      return applyContextSnapshot(state, event.snapshot, event.at, event.type);

    case "description-changed": {
      const empty = event.description.trim().length === 0;
      return next(
        state,
        {
          description: event.description,
          generation: state.generation + 1,
          envelope: null,
          openQuestionIds: [],
          recommendations: expireOpen(state.recommendations),
          phase: empty ? "discover" : "draft",
        },
        event.at,
        event.type,
        `generation ${state.generation + 1}`
      );
    }

    case "parse-completed": {
      if (event.generation !== state.generation) {
        // Result of an older description — never let it overwrite fresher state.
        return next(
          state,
          {},
          event.at,
          event.type,
          `stale-parse-ignored (event generation ${event.generation}, state generation ${state.generation})`
        );
      }
      const gaps = envelopeHasGaps(event.envelope);
      return next(
        state,
        {
          envelope: event.envelope,
          ruleVersion: state.ruleVersion + 1,
          phase: gaps ? "gaps" : "recommend",
        },
        event.at,
        event.type,
        gaps ? "parse landed with gaps" : "parse landed clean"
      );
    }

    case "clarification-answered":
      return next(
        state,
        { openQuestionIds: state.openQuestionIds.filter((id) => id !== event.questionId) },
        event.at,
        event.type,
        `question ${event.questionId} answered`
      );

    case "recommendations-issued":
      return next(
        state,
        { recommendations: [...state.recommendations, ...event.refs] },
        event.at,
        event.type,
        `${event.refs.length} recommendation(s) issued`
      );

    case "recommendation-accepted":
    case "recommendation-rejected": {
      const flipped = event.type === "recommendation-accepted" ? "accepted" : "rejected";
      const target = state.recommendations.find((r) => r.id === event.id);
      const fresh =
        target !== undefined &&
        target.status === "open" &&
        target.snapshotId === state.snapshotId &&
        target.ruleVersion === state.ruleVersion;
      if (!fresh) {
        // Consent must bind to the exact snapshot + rule version it previewed.
        return next(
          state,
          {},
          event.at,
          event.type,
          flipped === "accepted" ? "stale-accept-ignored" : "stale-reject-ignored"
        );
      }
      return next(
        state,
        {
          recommendations: state.recommendations.map((r) =>
            r.id === event.id ? { ...r, status: flipped as RecommendationRef["status"] } : r
          ),
        },
        event.at,
        event.type,
        `recommendation ${event.id} ${flipped}`
      );
    }

    case "fact-recorded":
      // Facts behave as a set: recording the same fact twice keeps one copy
      // (the history entry still records the attempt).
      return next(
        state,
        {
          acceptedFacts: state.acceptedFacts.includes(event.fact)
            ? state.acceptedFacts
            : [...state.acceptedFacts, event.fact],
        },
        event.at,
        event.type,
        `fact recorded`
      );

    case "phase-advanced":
      return next(state, { phase: event.phase }, event.at, event.type, `phase ${event.phase}`);
  }
}
