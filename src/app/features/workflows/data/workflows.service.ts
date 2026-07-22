import { Injectable, Provider, inject } from '@angular/core';
import { Observable, delay, map, of, throwError } from 'rxjs';
import { WorkflowRecord } from '../../../core/api';
import { proposalPayloadRule, shouldProposeWorkflowWrite } from '../../../core/fourEyes';
import { WorkflowRule, emptyRule, normalizeRule } from '../../../core/vocabulary';
import { ApiService } from '../../../shared/api.service';
import { APP_CONFIG, isMockMode } from '../../../shared/app-config';

export type { WorkflowRecord };

export interface WorkflowWrite {
  name: string;
  description?: string | null;
  enabled?: boolean;
  ruleJson: WorkflowRule;
  /** Optimistic-concurrency guard; the backend enforces it. */
  expectedVersion?: number;
}

/** A pending four-eyes proposal (Phase 13 flow, mock-backed here). */
export interface WorkflowProposal {
  id: string;
  workflowId: string;
  workflowName: string;
  proposedRule: WorkflowRule;
  proposedEnabled: boolean | null;
  proposedName: string | null;
  status: 'pending' | 'applied' | 'rejected';
  createdAt: string;
}

/**
 * The result of a save: either the write landed, or the four-eyes gate turned
 * it into a service-shaped proposal result.
 */
export type SaveOutcome =
  | { kind: 'saved'; record: WorkflowRecord }
  | { kind: 'proposed'; proposalId: string; record: WorkflowRecord };

/**
 * The persistence seam. Production impl targets the admin `workflows` service;
 * the mock serves seeded records so the feature runs with zero configuration.
 * Feature code injects THIS class and never knows which one it got.
 */
@Injectable()
export abstract class WorkflowsService {
  abstract list(): Observable<WorkflowRecord[]>;
  abstract get(id: string): Observable<WorkflowRecord>;
  abstract create(write: WorkflowWrite): Observable<WorkflowRecord>;
  abstract update(id: string, write: WorkflowWrite): Observable<SaveOutcome>;
  abstract remove(id: string): Observable<void>;
  abstract toggle(id: string, enabled: boolean): Observable<SaveOutcome>;
  abstract listProposals(): Observable<WorkflowProposal[]>;
  abstract approveProposal(id: string): Observable<WorkflowRecord>;
  abstract rejectProposal(id: string): Observable<void>;
}

/* -------------------------------------------------------------------------- */

/**
 * Live implementation. The admin `workflows` service does not yet expose a
 * rules/automation resource (open Q1 in both scan generations) — `/rules` is
 * the presumed shape and MUST be confirmed against the backend before this
 * impl is trusted. Until then mock mode is the default.
 */
@Injectable()
export class WorkflowsApiService extends WorkflowsService {
  private readonly api = inject(ApiService);

  list(): Observable<WorkflowRecord[]> {
    return this.api
      .get<unknown[]>('workflows', '/rules')
      .pipe(map((rows) => rows.map((row) => normalizeRecord(row))));
  }
  get(id: string): Observable<WorkflowRecord> {
    return this.api.get<unknown>('workflows', `/rules/${id}`).pipe(map(normalizeRecord));
  }
  create(write: WorkflowWrite): Observable<WorkflowRecord> {
    return this.api.post<unknown>('workflows', '/rules', write).pipe(map(normalizeRecord));
  }
  update(id: string, write: WorkflowWrite): Observable<SaveOutcome> {
    return this.api
      .put<unknown>('workflows', `/rules/${id}`, write)
      .pipe(map((row) => toSaveOutcome(row)));
  }
  remove(id: string): Observable<void> {
    return this.api.delete<void>('workflows', `/rules/${id}`);
  }
  toggle(id: string, enabled: boolean): Observable<SaveOutcome> {
    return this.api
      .put<unknown>('workflows', `/rules/${id}/enabled`, { enabled })
      .pipe(map((row) => toSaveOutcome(row)));
  }
  listProposals(): Observable<WorkflowProposal[]> {
    return this.api.get<WorkflowProposal[]>('workflows', '/rules/proposals');
  }
  approveProposal(id: string): Observable<WorkflowRecord> {
    return this.api
      .post<unknown>('workflows', `/rules/proposals/${id}/approve`, {})
      .pipe(map(normalizeRecord));
  }
  rejectProposal(id: string): Observable<void> {
    return this.api.post<void>('workflows', `/rules/proposals/${id}/reject`, {});
  }
}

/** Persisted rows may be schema v1/v2/v3 — normalize at the boundary, always. */
function normalizeRecord(row: unknown): WorkflowRecord {
  const r = row as Record<string, unknown>;
  return {
    id: String(r['id'] ?? ''),
    orgId: String(r['orgId'] ?? r['org_id'] ?? ''),
    name: String(r['name'] ?? 'Untitled workflow'),
    description: (r['description'] as string | null) ?? null,
    enabled: Boolean(r['enabled'] ?? true),
    ruleJson: normalizeRule(r['ruleJson'] ?? r['rule_json']),
    version: Number(r['version'] ?? 1),
    createdAt: String(r['createdAt'] ?? r['created_at'] ?? new Date().toISOString()),
    updatedAt: String(r['updatedAt'] ?? r['updated_at'] ?? new Date().toISOString()),
    pendingProposalId: (r['pendingProposalId'] as string | undefined) ?? undefined,
    proposalStatus: (r['proposalStatus'] as string | undefined) ?? undefined,
  };
}

function toSaveOutcome(row: unknown): SaveOutcome {
  const record = normalizeRecord(row);
  return record.pendingProposalId
    ? { kind: 'proposed', proposalId: record.pendingProposalId, record }
    : { kind: 'saved', record };
}

/* -------------------------------------------------------------------------- */

const DEMO_ORG = 'demo-org';

/** Seeded starters, mirroring the prototype's demo rules (labels, not ids). */
function seedRecords(): WorkflowRecord[] {
  // Spread creation/last-touched across a trailing window so the dashboard's
  // time-based widgets (activity area, sparklines, the signal tape) render a
  // real history instead of a single spike at "now".
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  let seq = 0;
  const AGES = [58, 31, 9]; // created N days ago, in seed order
  const TOUCHED = [4, 12, 1]; // last updated N days ago
  const base = (name: string, description: string, mutate: (rule: WorkflowRule) => void) => {
    const rule = emptyRule();
    mutate(rule);
    const i = seq++;
    return {
      id: crypto.randomUUID(),
      orgId: DEMO_ORG,
      name,
      description,
      enabled: true,
      ruleJson: rule,
      version: 1,
      createdAt: daysAgo(AGES[i] ?? 20),
      updatedAt: daysAgo(TOUCHED[i] ?? 3),
    } satisfies WorkflowRecord;
  };
  return [
    base('Booking error escalation', 'Escalate Fiserv/FMAC booking failures.', (rule) => {
      rule.triggers = [{ event: 'SYSTEM ERROR' }];
      rule.conditions = {
        logic: 'AND',
        children: [{ field: 'bookstatus', operator: 'is', value: 'Error' }],
      };
      rule.actions = [{ action: 'assign_user', params: { assignee: 'Booking Team' } }];
    }),
    base('Jumbo approval review', 'Route large approved loans to underwriting.', (rule) => {
      rule.triggers = [{ event: 'LOAN APPROVED' }];
      rule.conditions = {
        logic: 'AND',
        children: [{ field: 'loan_amount', operator: 'gte', value: '250000' }],
      };
      rule.actions = [
        { action: 'assign_user', params: { assignee: 'Underwriting Team' } },
        { action: 'add_tag', params: { value: 'jumbo' } },
      ];
    }),
    base('Rejection notice', 'Notify the team when a loan is rejected.', (rule) => {
      rule.triggers = [{ event: 'LOAN REJECTED' }];
      rule.actions = [{ action: 'notify', params: { value: 'Operations Team' } }];
    }),
  ];
}

const LATENCY_MS = 180; // keep async paths honest in dev

/**
 * In-memory backend for standalone/demo use. State resets on reload.
 *
 * The four-eyes gate is enforced HERE: an update or enable-toggle on a protected workflow becomes a
 * pending proposal instead of a direct write (the shared core decides —
 * shouldProposeWorkflowWrite). Cosmetic-only writes pass straight through.
 */
@Injectable()
export class WorkflowsMockService extends WorkflowsService {
  private rows = seedRecords();
  private proposals: WorkflowProposal[] = [];

  list(): Observable<WorkflowRecord[]> {
    return of(this.rows.map((row) => this.withProposalMarkers({ ...row }))).pipe(delay(LATENCY_MS));
  }
  get(id: string): Observable<WorkflowRecord> {
    const row = this.rows.find((r) => r.id === id);
    return row
      ? of(this.withProposalMarkers({ ...row })).pipe(delay(LATENCY_MS))
      : throwError(() => new Error(`Workflow ${id} not found`));
  }
  create(write: WorkflowWrite): Observable<WorkflowRecord> {
    const now = new Date().toISOString();
    const row: WorkflowRecord = {
      id: crypto.randomUUID(),
      orgId: DEMO_ORG,
      name: write.name,
      description: write.description ?? null,
      enabled: write.enabled ?? true,
      ruleJson: normalizeRule(write.ruleJson),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.rows = [row, ...this.rows];
    return of({ ...row }).pipe(delay(LATENCY_MS));
  }

  update(id: string, write: WorkflowWrite): Observable<SaveOutcome> {
    const index = this.rows.findIndex((r) => r.id === id);
    if (index === -1) return throwError(() => new Error(`Workflow ${id} not found`));
    const current = this.rows[index];
    if (write.expectedVersion !== undefined && write.expectedVersion !== current.version) {
      return throwError(
        () => new Error(`Version conflict: expected ${write.expectedVersion}, is ${current.version}`)
      );
    }

    if (
      shouldProposeWorkflowWrite({
        currentRule: current.ruleJson,
        currentEnabled: current.enabled,
        nextRule: write.ruleJson,
        nextEnabled: write.enabled,
      })
    ) {
      const proposal = this.spawnProposal(current, {
        proposedRule: proposalPayloadRule(write.ruleJson, current.ruleJson),
        proposedEnabled: write.enabled ?? null,
        proposedName: write.name !== current.name ? write.name : null,
      });
      return of<SaveOutcome>({
        kind: 'proposed',
        proposalId: proposal.id,
        record: this.withProposalMarkers({ ...current }),
      }).pipe(delay(LATENCY_MS));
    }

    // Unprotected (e.g. disabled shadow draft, or cosmetic-only) — write lands.
    const next: WorkflowRecord = {
      ...current,
      name: write.name,
      description: write.description ?? current.description,
      enabled: write.enabled ?? current.enabled,
      ruleJson: normalizeRule(write.ruleJson),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.rows[index] = next;
    return of<SaveOutcome>({ kind: 'saved', record: { ...next } }).pipe(delay(LATENCY_MS));
  }

  remove(id: string): Observable<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
    this.proposals = this.proposals.filter((p) => p.workflowId !== id);
    return of(void 0).pipe(delay(LATENCY_MS));
  }

  toggle(id: string, enabled: boolean): Observable<SaveOutcome> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return throwError(() => new Error(`Workflow ${id} not found`));

    if (
      shouldProposeWorkflowWrite({
        currentRule: row.ruleJson,
        currentEnabled: row.enabled,
        nextEnabled: enabled,
      })
    ) {
      const proposal = this.spawnProposal(row, {
        proposedRule: row.ruleJson,
        proposedEnabled: enabled,
        proposedName: null,
      });
      return of<SaveOutcome>({
        kind: 'proposed',
        proposalId: proposal.id,
        record: this.withProposalMarkers({ ...row }),
      }).pipe(delay(LATENCY_MS));
    }

    row.enabled = enabled;
    row.updatedAt = new Date().toISOString();
    return of<SaveOutcome>({ kind: 'saved', record: { ...row } }).pipe(delay(LATENCY_MS));
  }

  listProposals(): Observable<WorkflowProposal[]> {
    return of(this.proposals.map((p) => ({ ...p }))).pipe(delay(LATENCY_MS));
  }

  approveProposal(id: string): Observable<WorkflowRecord> {
    const proposal = this.proposals.find((p) => p.id === id && p.status === 'pending');
    if (!proposal) return throwError(() => new Error('Proposal not found or already decided'));
    const index = this.rows.findIndex((r) => r.id === proposal.workflowId);
    if (index === -1) return throwError(() => new Error('Workflow no longer exists'));
    const current = this.rows[index];
    const next: WorkflowRecord = {
      ...current,
      name: proposal.proposedName ?? current.name,
      enabled: proposal.proposedEnabled ?? current.enabled,
      ruleJson: proposal.proposedRule,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.rows[index] = next;
    proposal.status = 'applied';
    return of({ ...next }).pipe(delay(LATENCY_MS));
  }

  rejectProposal(id: string): Observable<void> {
    const proposal = this.proposals.find((p) => p.id === id && p.status === 'pending');
    if (!proposal) return throwError(() => new Error('Proposal not found or already decided'));
    proposal.status = 'rejected';
    return of(void 0).pipe(delay(LATENCY_MS));
  }

  private spawnProposal(
    row: WorkflowRecord,
    body: Pick<WorkflowProposal, 'proposedRule' | 'proposedEnabled' | 'proposedName'>
  ): WorkflowProposal {
    // One pending proposal per workflow — a newer edit supersedes it.
    this.proposals = this.proposals.filter(
      (p) => !(p.workflowId === row.id && p.status === 'pending')
    );
    const proposal: WorkflowProposal = {
      id: crypto.randomUUID(),
      workflowId: row.id,
      workflowName: row.name,
      status: 'pending',
      createdAt: new Date().toISOString(),
      ...body,
    };
    this.proposals = [proposal, ...this.proposals];
    return proposal;
  }

  private withProposalMarkers(row: WorkflowRecord): WorkflowRecord {
    const pending = this.proposals.find(
      (p) => p.workflowId === row.id && p.status === 'pending'
    );
    if (pending) {
      row.pendingProposalId = pending.id;
      row.proposalStatus = 'pending';
    }
    return row;
  }
}

/** Route-level provider: mock when unconfigured, API when credentials exist. */
export function provideWorkflowsService(): Provider {
  return {
    provide: WorkflowsService,
    useFactory: () => {
      const config = inject(APP_CONFIG);
      return isMockMode(config) ? new WorkflowsMockService() : inject(WorkflowsApiService);
    },
  };
}
