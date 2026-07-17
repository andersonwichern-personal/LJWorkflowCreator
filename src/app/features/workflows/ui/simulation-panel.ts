import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { PlatformRequest, REQUESTS } from '../../../core/platformData';
import { SimulationTrace, ruleMatches, simulateRule } from '../../../core/ruleEvaluator';
import { WorkflowRule } from '../../../core/vocabulary';
import { PickerOption, TokenPicker } from './token-picker';

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
        placeholder="pick a request…"
        [options]="requestOptions"
        (selected)="select($event)"
      />
      <button type="button" class="ghost" (click)="backtest()">Backtest all {{ total }}</button>
    </div>

    @if (trace(); as t) {
      <div class="verdict" [class.hit]="t.matched" [class.miss]="!t.matched">
        {{ t.matched ? '✓ Rule fires for this request' : '✗ Rule does not fire' }}
      </div>

      <div class="section">Triggers (any may match)</div>
      @for (trigger of t.trace.triggers; track $index) {
        <div class="row" [class.ok]="trigger.matched" [class.no]="!trigger.matched">
          <span class="dot"></span>
          <span>{{ trigger.event }}</span>
          <span class="end">{{ trigger.matched ? 'matched' : 'no match' }}</span>
        </div>
      }

      @if (t.trace.conditions.length) {
        <div class="section">Conditions</div>
        @for (condition of t.trace.conditions; track $index) {
          <div
            class="row"
            [class.ok]="condition.matched"
            [class.no]="!condition.matched"
            [style.paddingLeft.px]="12 + condition.depth * 22"
          >
            <span class="dot"></span>
            <span>{{ condition.label }} <i>{{ condition.operator }}</i> {{ condition.expected }}</span>
            <span class="end">{{ condition.actual === null ? 'unknown' : condition.actual }}</span>
          </div>
        }
      }

      @if (t.actions.length) {
        <div class="section">Would dispatch</div>
        @for (action of t.actions; track $index) {
          <div class="row ok"><span class="dot"></span><span>{{ action }}</span></div>
        }
      }
      @if (t.elseActions.length) {
        <div class="section">Otherwise lane (triggers matched, conditions failed)</div>
        @for (action of t.elseActions; track $index) {
          <div class="row warn-row"><span class="dot"></span><span>{{ action }}</span></div>
        }
      }
      @for (alert of t.alerts; track $index) {
        <div class="alert">⚠ {{ alert }}</div>
      }
    }

    @if (backtestResult(); as b) {
      <div class="backtest">
        <b>{{ b.hits.length }}</b> of <b>{{ total }}</b> seed requests would fire.
        @if (b.hits.length) {
          <span class="hits">
            @for (hit of b.hits; track hit.id) {
              <button type="button" class="hit-chip" (click)="select(hit.id)">{{ hit.id }}</button>
            }
          </span>
        }
      </div>
    }
  `,
  styles: `
    .head { display: flex; align-items: center; gap: 10px; }
    .ghost {
      font: inherit; font-size: 12px; font-weight: 600; color: var(--text-dim);
      background: none; border: 1px dashed var(--border); border-radius: 999px;
      padding: 4px 12px; cursor: pointer;
    }
    .ghost:hover { color: var(--text); border-color: var(--brand); }
    .verdict { margin-top: 12px; font-size: 13px; font-weight: 700; border-radius: 10px; padding: 9px 12px; }
    .verdict.hit { background: color-mix(in srgb, var(--brand) 15%, transparent); color: var(--brand-text); }
    .verdict.miss { background: var(--surface-inset); color: var(--text-dim); }
    .section {
      margin: 14px 0 6px; font-size: 10px; font-weight: 800;
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim);
    }
    .row {
      display: flex; align-items: baseline; gap: 8px; font-size: 13px;
      padding: 5px 12px; border-radius: 8px;
    }
    .row i { font-style: normal; color: var(--text-dim); }
    .row .end { margin-left: auto; font-size: 12px; color: var(--text-dim); }
    .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; align-self: center; background: var(--border); }
    .row.ok .dot { background: var(--brand); }
    .row.no .dot { background: var(--danger); }
    .warn-row .dot { background: var(--warn); }
    .alert { margin-top: 8px; font-size: 12px; border-radius: 8px; padding: 8px 12px; background: var(--warn-bg); color: var(--warn-text); }
    .backtest { margin-top: 14px; font-size: 13px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .hits { display: inline-flex; flex-wrap: wrap; gap: 6px; }
    .hit-chip {
      font: inherit; font-size: 11px; font-weight: 700; cursor: pointer;
      color: var(--brand-text); background: color-mix(in srgb, var(--brand) 12%, transparent);
      border: 0; border-radius: 999px; padding: 3px 10px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SimulationPanel {
  @Input({ required: true }) set rule(value: WorkflowRule) {
    this.currentRule.set(value);
    this.backtestResult.set(null);
  }

  protected readonly total = REQUESTS.length;
  protected readonly requestOptions: PickerOption[] = REQUESTS.map((request) => ({
    value: request.id,
    label: `${request.id} — ${request.name}`,
    hint: request.stage,
  }));

  private readonly currentRule = signal<WorkflowRule | null>(null);
  private readonly selectedId = signal<string | null>(null);
  protected readonly backtestResult = signal<{ hits: PlatformRequest[] } | null>(null);

  protected readonly selectedLabel = computed(() => this.selectedId() ?? '');

  protected readonly trace = computed<SimulationTrace | null>(() => {
    const rule = this.currentRule();
    const id = this.selectedId();
    if (!rule || !id) return null;
    const request = REQUESTS.find((r) => r.id === id);
    return request ? simulateRule(rule, request) : null;
  });

  protected select(id: string) {
    this.selectedId.set(id);
  }

  protected backtest() {
    const rule = this.currentRule();
    if (!rule) return;
    this.backtestResult.set({ hits: REQUESTS.filter((request) => ruleMatches(rule, request)) });
  }
}
