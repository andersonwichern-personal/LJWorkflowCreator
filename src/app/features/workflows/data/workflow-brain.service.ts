import { Injectable, computed, inject, signal } from '@angular/core';
import { UserSessionService } from '../../../core/user-session.service';
import { ParseResult } from '../../../core/nlParser';
import { segmentInstruction } from '../../../core/parserClauses';
import { findContradictions } from '../../../core/parserContradictions';
import { clauseCoverage } from '../../../core/parserCoverage';
import {
  PARSER_ENGINE_VERSION,
  ParseEnvelope,
  makeEnvelope,
} from '../../../core/parserProvenance';
import { WorkflowRule } from '../../../core/vocabulary';
import {
  BrainEvent,
  BrainSessionState,
  RecommendationRef,
  initialBrainState,
  reduceBrain,
} from '../../../brain/brainState';
import { BrainContextSnapshot } from '../../../brain/context';
import {
  AcceptOutcome,
  ConsultantTurn,
  acceptRecommendation,
  planConsultantTurn,
  rejectRecommendation,
} from '../../../brain/consultant';
import { Recommendation } from '../../../brain/recommendations';
import { WORKFLOW_BRAIN_CONTEXT } from './workflow-brain-context.token';

/**
 * Angular host adapter around the pure Workflow Brain session.
 *
 * The Brain stays framework-free: this service owns the ports the Brain must
 * not (the context provider via WORKFLOW_BRAIN_CONTEXT, the wall clock, the
 * four-eyes flag from UserSessionService) and holds the deterministic
 * BrainSessionState behind signals for the composer. Every parse result is
 * wrapped into a full ParseEnvelope (clauses + coverage links +
 * contradictions) before the consultant analyzers see it, so recommendations
 * always run on the same evidence surface the parser produced.
 *
 * Consent stays exact and stale-safe: accept() routes through
 * acceptRecommendation with the CURRENT {snapshotId, ruleVersion}, and decided
 * recommendation ids (content hashes) are filtered from re-planned turns so a
 * rejected recommendation never nags again without new evidence.
 */
@Injectable({ providedIn: 'root' })
export class WorkflowBrainService {
  private readonly provider = inject(WORKFLOW_BRAIN_CONTEXT);
  private readonly session = inject(UserSessionService);
  /** Host-owned clock — the Brain itself never reads time. */
  private readonly clock = { now: () => Date.now() };

  private readonly stateSignal = signal<BrainSessionState>(
    initialBrainState('standalone-demo', 'standalone-demo')
  );
  private readonly snapshotSignal = signal<BrainContextSnapshot | null>(null);
  private readonly turnSignal = signal<ConsultantTurn | null>(null);

  readonly snapshot = this.snapshotSignal.asReadonly();
  readonly turn = this.turnSignal.asReadonly();
  readonly ruleVersion = computed(() => this.stateSignal().ruleVersion);

  constructor() {
    void this.attachContext();
  }

  private dispatch(event: BrainEvent): void {
    this.stateSignal.set(reduceBrain(this.stateSignal(), event));
  }

  /** Fetch and attach the provider's snapshot (local + deterministic — no network). */
  async attachContext(): Promise<BrainContextSnapshot> {
    const snapshot = await this.provider.getSnapshot({
      profile: this.provider.profile,
      purpose: 'consult',
    });
    this.dispatch({ type: 'context-attached', snapshot, at: this.clock.now() });
    this.snapshotSignal.set(snapshot);
    return snapshot;
  }

  /** A new description generation: everything derived from the old one is stale. */
  onDescriptionChanged(text: string): void {
    if (this.stateSignal().description === text) return;
    this.turnSignal.set(null);
    this.dispatch({ type: 'description-changed', description: text, at: this.clock.now() });
  }

  /**
   * Wrap a ParseResult into the honest envelope (clauses, clause→rule links,
   * contradictions, unsupported/negated sidecars, provenance) and land it in
   * the session state. `generation` is the host's build generation — recorded
   * in provenance; the caller has already discarded stale responses.
   */
  onParseCompleted(result: ParseResult, generation: number, sourceText: string): ParseEnvelope {
    const { clauses } = segmentInstruction(sourceText);
    const coverage = clauseCoverage(clauses, result);
    const snapshot = this.snapshotSignal();
    const envelope = makeEnvelope(result, {
      clauses,
      clauseLinks: coverage.links,
      contradictions: result.rule ? findContradictions(result.rule, clauses) : [],
      unsupported: clauses
        .filter((clause) => clause.kind === 'unsupported')
        .map((clause) => ({
          clauseId: clause.id,
          text: clause.text,
          reason: clause.unsupportedReason ?? 'not supported by this platform',
        })),
      negatedNoOps: clauses
        .filter((clause) => clause.negated === true)
        .map((clause) => ({ clauseId: clause.id, text: clause.text })),
      provenance: {
        engine: 'deterministic',
        parserVersion: PARSER_ENGINE_VERSION,
        generation,
        createdAt: this.clock.now(),
        vocabularyHash: snapshot?.vocabularyHash,
        contextSnapshotId: snapshot?.snapshotId,
      },
    });
    this.dispatch({
      type: 'parse-completed',
      envelope,
      generation: this.stateSignal().generation,
      at: this.clock.now(),
    });
    return envelope;
  }

  /**
   * Plan one consultant turn for the current rule + envelope. Newly derived
   * recommendations are issued into the session ledger; already-decided ids
   * (accept/reject are content-hash-sticky) are filtered from the shown turn.
   */
  planTurn(
    rule: WorkflowRule | null,
    envelope: ParseEnvelope,
    ruleVersion = this.stateSignal().ruleVersion
  ): ConsultantTurn | null {
    const snapshot = this.snapshotSignal();
    if (!snapshot) return null;
    const state = this.stateSignal();
    const turn = planConsultantTurn({
      rule,
      envelope,
      snapshot,
      ruleVersion,
      sourceText: state.description || undefined,
      // Host four-eyes policy, pass-through: makers must propose, never activate.
      requiresApproval: this.session.mustProposeWorkflow(),
    });
    const known = new Set(state.recommendations.map((ref) => ref.id));
    const issued: RecommendationRef[] = turn.recommendations
      .filter((rec) => !known.has(rec.id))
      .map((rec) => ({
        id: rec.id,
        status: 'open',
        snapshotId: rec.expiresWith.snapshotId,
        ruleVersion: rec.expiresWith.ruleVersion,
      }));
    if (issued.length > 0) {
      this.dispatch({ type: 'recommendations-issued', refs: issued, at: this.clock.now() });
    }
    this.turnSignal.set(this.withoutDecided(turn));
    return this.turnSignal();
  }

  /**
   * Exact, stale-safe consent: applies ONLY the previewed ops, against the
   * CURRENT snapshot + rule version. The caller routes an ok-with-patch
   * outcome through the composer's single rule-mutation path.
   */
  accept(rec: Recommendation, rule: WorkflowRule): AcceptOutcome {
    const state = this.stateSignal();
    const outcome = acceptRecommendation(rec, rule, {
      snapshotId: state.snapshotId ?? '',
      ruleVersion: state.ruleVersion,
    });
    if (outcome.ok) {
      this.dispatch({ type: 'recommendation-accepted', id: rec.id, at: this.clock.now() });
      if (outcome.rule !== rule) {
        this.dispatch({ type: 'patch-applied', recommendationId: rec.id, at: this.clock.now() });
      }
      this.dropFromTurn(rec.id);
    }
    return outcome;
  }

  /** Record a rejection; the same content-hash id stays suppressed on re-plans. */
  reject(rec: Recommendation): RecommendationRef {
    const ref = rejectRecommendation(rec);
    this.dispatch({ type: 'recommendation-rejected', id: rec.id, at: this.clock.now() });
    this.dropFromTurn(rec.id);
    return ref;
  }

  /** No result on screen — no advisory turn. */
  clearTurn(): void {
    this.turnSignal.set(null);
  }

  private withoutDecided(turn: ConsultantTurn): ConsultantTurn {
    const decided = new Set(
      this.stateSignal()
        .recommendations.filter((ref) => ref.status === 'accepted' || ref.status === 'rejected')
        .map((ref) => ref.id)
    );
    if (decided.size === 0) return turn;
    const recommendations = turn.recommendations.filter((rec) => !decided.has(rec.id));
    return {
      ...turn,
      recommendations,
      proposedChanges: turn.proposedChanges.filter((change) =>
        recommendations.some((rec) => rec.id === change.recommendationId)
      ),
    };
  }

  private dropFromTurn(id: string): void {
    const turn = this.turnSignal();
    if (!turn) return;
    this.turnSignal.set({
      ...turn,
      recommendations: turn.recommendations.filter((rec) => rec.id !== id),
      proposedChanges: turn.proposedChanges.filter((change) => change.recommendationId !== id),
    });
  }
}
