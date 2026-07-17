import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { PlatformRequest, REQUESTS } from '../../../core/platformData';
import { SimulationTrace, simulateRule } from '../../../core/ruleEvaluator';
import { WorkflowRule } from '../../../core/vocabulary';
import { PickerOption, TokenPicker } from './token-picker';

type OutcomeKind = 'run' | 'skip' | 'unknown';

interface OutcomeCopy {
  kind: OutcomeKind;
  label: 'Would run' | 'Would skip' | 'Could not evaluate';
  reason: string;
}

interface BatchResult {
  runs: PlatformRequest[];
  skips: PlatformRequest[];
  unknown: PlatformRequest[];
}

/**
 * Dry-run simulator + backtest over the seed dataset, driven entirely by the
 * shared traced evaluator (core/ruleEvaluator). Every trigger and condition is
 * traced (no short-circuit hiding), alerts surface missingData:"alert" fields,
 * and the else-lane is shown when triggers matched but conditions failed.
 *
 * Context fields (aggregate_exposure) are NOT resolved here — the evaluator
 * fails closed on them until the host supplies the dynamic values.
 */
@Component({
  selector: 'wf-simulation-panel',
  imports: [TokenPicker],
  template: `
    <div class="head">
      <wf-token-picker
        [label]="selectedLabel()"
        placeholder="Choose a request…"
        [options]="requestOptions"
        (selected)="select($event)"
      />
      <button type="button" class="test-all" (click)="testAll()">Test all {{ total }} requests</button>
    </div>

    @if (outcome(); as result) {
      <section
        class="outcome"
        [class.run]="result.kind === 'run'"
        [class.skip]="result.kind === 'skip'"
        [class.unknown]="result.kind === 'unknown'"
        aria-live="polite"
      >
        <span class="outcome-mark" aria-hidden="true"></span>
        <div>
          <p class="outcome-label">{{ result.label }}</p>
          <p class="outcome-reason">{{ result.reason }}</p>
        </div>
      </section>

      @if (trace(); as t) {
        <details class="trace-details">
          <summary>Why this result</summary>
          <div class="trace-body">
            <p class="section">Starting event</p>
            @for (trigger of t.trace.triggers; track $index) {
              <div class="row" [class.ok]="trigger.matched" [class.no]="!trigger.matched">
                <span class="dot" aria-hidden="true"></span>
                <span>{{ trigger.event }}</span>
                <span class="end">{{ trigger.matched ? 'Matches request' : 'Does not match' }}</span>
              </div>
            }

            @if (t.trace.conditions.length) {
              <p class="section">Required details</p>
              @for (condition of t.trace.conditions; track $index) {
                <div
                  class="row"
                  [class.ok]="condition.matched"
                  [class.no]="!condition.matched"
                  [class.missing]="condition.actual === null"
                  [style.paddingLeft.px]="12 + condition.depth * 22"
                >
                  <span class="dot" aria-hidden="true"></span>
                  <span>{{ condition.label }} <i>{{ condition.operator }}</i> {{ condition.expected }}</span>
                  <span class="end">
                    {{ condition.actual === null ? 'Missing' : condition.matched ? 'Matches' : 'Does not match' }}
                  </span>
                </div>
              }
            }

            @if (t.actions.length) {
              <p class="section">What Sweet would do</p>
              @for (action of t.actions; track $index) {
                <div class="row ok"><span class="dot" aria-hidden="true"></span><span>{{ action }}</span></div>
              }
            }
            @if (t.elseActions.length) {
              <p class="section">What Sweet would do instead</p>
              @for (action of t.elseActions; track $index) {
                <div class="row alternate"><span class="dot" aria-hidden="true"></span><span>{{ action }}</span></div>
              }
            }
            @for (alert of t.alerts; track $index) {
              <div class="alert">{{ alert }}</div>
            }
          </div>
        </details>
      }
    }

    @if (batchResult(); as batch) {
      <section class="batch" aria-live="polite">
        <p class="batch-title">Results across {{ total }} sample requests</p>
        <div class="batch-stats">
          <span><b>{{ batch.runs.length }}</b> would run</span>
          <span><b>{{ batch.skips.length }}</b> would skip</span>
          <span><b>{{ batch.unknown.length }}</b> could not evaluate</span>
        </div>
        @if (batch.runs.length || batch.unknown.length) {
          <div class="samples">
            @for (request of batch.runs; track request.id) {
              <button type="button" class="sample run" (click)="select(request.id)">
                {{ request.id }} · would run
              </button>
            }
            @for (request of batch.unknown; track request.id) {
              <button type="button" class="sample unknown" (click)="select(request.id)">
                {{ request.id }} · needs data
              </button>
            }
          </div>
        }
      </section>
    }
  `,
  styles: `
    :host { display: block; }
    .head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
    .test-all {
      min-height: 42px; padding: .55rem .9rem; border: 1px solid var(--border); border-radius: var(--radius-pill);
      background: transparent; color: var(--text-dim); font-size: var(--text-xs); font-weight: 750; cursor: pointer;
    }
    .test-all:hover { color: var(--text); border-color: var(--border-strong); }
    .outcome { display: flex; align-items: flex-start; gap: var(--space-4); margin-top: var(--space-6); padding: var(--space-5); background: var(--surface-inset); border-radius: var(--radius-lg); }
    .outcome-mark { width: .75rem; height: .75rem; margin-top: .32rem; flex: 0 0 auto; border-radius: 50%; background: var(--text-soft); }
    .outcome.run .outcome-mark { background: var(--success); }
    .outcome.skip .outcome-mark { background: var(--text-dim); }
    .outcome.unknown .outcome-mark { background: var(--warn); }
    .outcome-label { margin: 0; color: var(--text); font-size: var(--text-lg); font-weight: 780; }
    .outcome-reason { margin: var(--space-2) 0 0; color: var(--text-dim); line-height: 1.6; }
    .trace-details { margin-top: var(--space-4); border-top: 1px solid var(--border); }
    .trace-details summary { min-height: 44px; padding: var(--space-3) 0; color: var(--text-dim); font-size: var(--text-xs); font-weight: 750; cursor: pointer; }
    .trace-body { padding: var(--space-2) 0 var(--space-4); }
    .section {
      margin: var(--space-5) 0 var(--space-2); color: var(--text-soft);
      font-size: .68rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
    }
    .row {
      display: flex; align-items: baseline; gap: var(--space-2); min-height: 34px;
      padding: var(--space-2) var(--space-3); color: var(--text); font-size: var(--text-sm);
    }
    .row i { font-style: normal; color: var(--text-dim); }
    .row .end { margin-left: auto; color: var(--text-dim); font-size: var(--text-xs); text-align: right; }
    .dot { width: .45rem; height: .45rem; border-radius: 50%; flex: 0 0 auto; align-self: center; background: var(--border-strong); }
    .row.ok .dot { background: var(--success); }
    .row.no .dot { background: var(--text-soft); }
    .row.missing .dot, .alternate .dot { background: var(--warn); }
    .alert { margin-top: var(--space-3); padding: var(--space-3); border-left: 3px solid var(--warn); color: var(--warn-text); background: var(--warn-bg); font-size: var(--text-xs); }
    .batch { margin-top: var(--space-6); padding-top: var(--space-5); border-top: 1px solid var(--border); }
    .batch-title { margin: 0; font-weight: 750; }
    .batch-stats { display: flex; gap: var(--space-5); flex-wrap: wrap; margin-top: var(--space-3); color: var(--text-dim); font-size: var(--text-sm); }
    .batch-stats b { color: var(--text); font-size: var(--text-lg); }
    .samples { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); }
    .sample {
      min-height: 36px; padding: .4rem .7rem; border: 0; border-radius: var(--radius-pill);
      color: var(--text-dim); background: var(--surface-inset); font-size: var(--text-xs); font-weight: 700; cursor: pointer;
    }
    .sample.run { color: var(--success); background: var(--success-bg); }
    .sample.unknown { color: var(--warn-text); background: var(--warn-bg); }
    @media (max-width: 560px) {
      .head { align-items: stretch; flex-direction: column; }
      .test-all { width: 100%; }
      .row { align-items: flex-start; flex-wrap: wrap; }
      .row .end { width: 100%; margin-left: calc(.45rem + var(--space-2)); text-align: left; }
      .batch-stats { flex-direction: column; gap: var(--space-2); }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SimulationPanel {
  @Input({ required: true }) set rule(value: WorkflowRule) {
    this.currentRule.set(value);
    this.batchResult.set(null);
  }

  protected readonly total = REQUESTS.length;
  protected readonly requestOptions: PickerOption[] = REQUESTS.map((request) => ({
    value: request.id,
    label: `${request.id} — ${request.name}`,
    hint: request.stage,
  }));

  private readonly currentRule = signal<WorkflowRule | null>(null);
  private readonly selectedId = signal<string | null>(null);
  protected readonly batchResult = signal<BatchResult | null>(null);

  protected readonly selectedLabel = computed(() => this.selectedId() ?? '');

  protected readonly trace = computed<SimulationTrace | null>(() => {
    const rule = this.currentRule();
    const id = this.selectedId();
    if (!rule || !id) return null;
    const request = REQUESTS.find((r) => r.id === id);
    return request ? simulateRule(rule, request) : null;
  });
  protected readonly outcome = computed<OutcomeCopy | null>(() => {
    const trace = this.trace();
    return trace ? describeOutcome(trace) : null;
  });

  protected select(id: string) {
    this.selectedId.set(id);
  }

  protected testAll() {
    const rule = this.currentRule();
    if (!rule) return;
    const result: BatchResult = { runs: [], skips: [], unknown: [] };
    for (const request of REQUESTS) {
      const kind = describeOutcome(simulateRule(rule, request)).kind;
      if (kind === 'run') result.runs.push(request);
      else if (kind === 'skip') result.skips.push(request);
      else result.unknown.push(request);
    }
    this.batchResult.set(result);
  }
}

function describeOutcome(trace: SimulationTrace): OutcomeCopy {
  if (trace.matched) {
    return {
      kind: 'run',
      label: 'Would run',
      reason: 'The starting event and all required details match this workflow.',
    };
  }

  const missing = trace.trace.conditions
    .filter((condition) => condition.actual === null)
    .map((condition) => condition.label);
  if (trace.trace.matchedTrigger && missing.length) {
    const fields = [...new Set(missing)];
    return {
      kind: 'unknown',
      label: 'Could not evaluate',
      reason: `${fields.join(', ')} ${fields.length === 1 ? 'is' : 'are'} missing from this request.`,
    };
  }

  if (!trace.trace.matchedTrigger) {
    return {
      kind: 'skip',
      label: 'Would skip',
      reason: 'The starting event does not match this request.',
    };
  }

  const mismatches = trace.trace.conditions
    .filter((condition) => !condition.matched)
    .map((condition) => condition.label);
  const fields = [...new Set(mismatches)];
  return {
    kind: 'skip',
    label: 'Would skip',
    reason: fields.length
      ? `${fields.join(', ')} ${fields.length === 1 ? 'does' : 'do'} not match this workflow.`
      : 'This request does not match the workflow requirements.',
  };
}
