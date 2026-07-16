import { Injectable, Provider, inject } from '@angular/core';
import { Observable, delay, map, of, throwError } from 'rxjs';
import { WorkflowRule, emptyRule, normalizeRule } from '../../../core/vocabulary';
import { ApiService } from '../../../shared/api.service';
import { APP_CONFIG, isMockMode } from '../../../shared/app-config';

/** A saved workflow record — the track-shared shape (rule core + envelope). */
export interface WorkflowRecord {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  ruleJson: WorkflowRule;
  version: number;
  updatedAt: string; // ISO
}

export interface WorkflowWrite {
  name: string;
  description?: string | null;
  enabled?: boolean;
  ruleJson: WorkflowRule;
  /** Optimistic-concurrency guard (Vercel track Phase 8 §12); API enforces. */
  expectedVersion?: number;
}

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
  abstract update(id: string, write: WorkflowWrite): Observable<WorkflowRecord>;
  abstract remove(id: string): Observable<void>;
  abstract toggle(id: string, enabled: boolean): Observable<WorkflowRecord>;
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
  update(id: string, write: WorkflowWrite): Observable<WorkflowRecord> {
    return this.api.put<unknown>('workflows', `/rules/${id}`, write).pipe(map(normalizeRecord));
  }
  remove(id: string): Observable<void> {
    return this.api.delete<void>('workflows', `/rules/${id}`);
  }
  toggle(id: string, enabled: boolean): Observable<WorkflowRecord> {
    return this.api
      .put<unknown>('workflows', `/rules/${id}/enabled`, { enabled })
      .pipe(map(normalizeRecord));
  }
}

/** Persisted rows may be schema v1/v2/v3 — normalize at the boundary, always. */
function normalizeRecord(row: unknown): WorkflowRecord {
  const r = row as Record<string, unknown>;
  return {
    id: String(r['id'] ?? ''),
    name: String(r['name'] ?? 'Untitled workflow'),
    description: (r['description'] as string | null) ?? null,
    enabled: Boolean(r['enabled'] ?? true),
    ruleJson: normalizeRule(r['ruleJson'] ?? r['rule_json']),
    version: Number(r['version'] ?? 1),
    updatedAt: String(r['updatedAt'] ?? r['updated_at'] ?? new Date().toISOString()),
  };
}

/* -------------------------------------------------------------------------- */

/** Seeded starters, mirroring the prototype's demo rules (labels, not ids). */
function seedRecords(): WorkflowRecord[] {
  const base = (name: string, description: string, mutate: (rule: WorkflowRule) => void) => {
    const rule = emptyRule();
    mutate(rule);
    return {
      id: crypto.randomUUID(),
      name,
      description,
      enabled: true,
      ruleJson: rule,
      version: 1,
      updatedAt: new Date().toISOString(),
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

/** In-memory backend for standalone/demo use. State resets on reload. */
@Injectable()
export class WorkflowsMockService extends WorkflowsService {
  private rows = seedRecords();

  list(): Observable<WorkflowRecord[]> {
    return of(this.rows.map((row) => ({ ...row }))).pipe(delay(LATENCY_MS));
  }
  get(id: string): Observable<WorkflowRecord> {
    const row = this.rows.find((r) => r.id === id);
    return row
      ? of({ ...row }).pipe(delay(LATENCY_MS))
      : throwError(() => new Error(`Workflow ${id} not found`));
  }
  create(write: WorkflowWrite): Observable<WorkflowRecord> {
    const row: WorkflowRecord = {
      id: crypto.randomUUID(),
      name: write.name,
      description: write.description ?? null,
      enabled: write.enabled ?? true,
      ruleJson: normalizeRule(write.ruleJson),
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    this.rows = [row, ...this.rows];
    return of({ ...row }).pipe(delay(LATENCY_MS));
  }
  update(id: string, write: WorkflowWrite): Observable<WorkflowRecord> {
    const index = this.rows.findIndex((r) => r.id === id);
    if (index === -1) return throwError(() => new Error(`Workflow ${id} not found`));
    const current = this.rows[index];
    if (write.expectedVersion !== undefined && write.expectedVersion !== current.version) {
      return throwError(
        () => new Error(`Version conflict: expected ${write.expectedVersion}, is ${current.version}`)
      );
    }
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
    return of({ ...next }).pipe(delay(LATENCY_MS));
  }
  remove(id: string): Observable<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
    return of(void 0).pipe(delay(LATENCY_MS));
  }
  toggle(id: string, enabled: boolean): Observable<WorkflowRecord> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return throwError(() => new Error(`Workflow ${id} not found`));
    row.enabled = enabled;
    row.updatedAt = new Date().toISOString();
    return of({ ...row }).pipe(delay(LATENCY_MS));
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
