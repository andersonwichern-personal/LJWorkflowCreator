import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { interpretRule } from '../../../core/interpretation';
import { STATE_LABELS, protectionsFor, workflowState } from '../../../core/orgPolicy';
import { lintRule } from '../../../core/ruleLinter';
import {
  ExplainedResult,
  SimOutcome,
  explainSimulation,
} from '../../../core/simulationExplainer';
import {
  WorkflowRule,
  condFieldLabel,
  getAction,
  isValuelessOperator,
  paramKeyFor,
  scopeLabel,
  walkLeaves,
} from '../../../core/vocabulary';
import { ConfirmationDialog } from '../../../shared/confirmation-dialog';
import { LJ_PRIMITIVES } from '../../../shared/lj/lj';
import {
  SaveOutcome,
  WorkflowRecord,
  WorkflowsService,
} from '../data/workflows.service';
import { WORKFLOW_ACCESS_POLICY } from '../data/workflow-access-policy';

type LifecycleAction = 'activate' | 'pause' | 'resume';

interface DetailConfirmation {
  action: LifecycleAction;
  title: string;
  description: string;
  confirmLabel: string;
}

function armedRule(rule: WorkflowRule): WorkflowRule {
  return { ...rule, controls: { ...rule.controls, mode: 'armed' } };
}

/** Structural, semantic, and completeness gate for any transition into live actions. */
function activationBlocker(rule: WorkflowRule): string | null {
  const candidate = armedRule(rule);
  if (candidate.actions.length === 0) return 'Add at least one action before activation.';

  const incompleteCondition = walkLeaves(candidate.conditions).find(
    (condition) =>
      !isValuelessOperator(condition.operator) && !scopeLabel(condition.value).trim()
  );
  if (incompleteCondition) {
    return `${condFieldLabel(incompleteCondition.field)} still needs a value.`;
  }

  const incompleteAction = [...candidate.actions, ...(candidate.else ?? [])].find((action) => {
    const definition = getAction(action.action);
    return (
      definition?.paramKind !== undefined &&
      definition.paramKind !== 'none' &&
      !scopeLabel(action.params[paramKeyFor(action.action)]).trim()
    );
  });
  if (incompleteAction) {
    return `${getAction(incompleteAction.action)?.label ?? 'An action'} still needs a destination or value.`;
  }

  return lintRule(candidate).issues.find((issue) => issue.severity === 'error')?.message ?? null;
}

/**
 * Client-facing workflow detail. The canonical rule remains deterministic,
 * while this page explains it in operational language and keeps technical
 * editing behind an explicitly labelled internal-tools path.
 */
@Component({
  selector: 'wf-workflow-detail-page',
  imports: [...LJ_PRIMITIVES, RouterLink, DatePipe, ConfirmationDialog],
  template: `
    <lj-page>
      <header header class="page-header">
        <lj-box class="header" [padding]="0">
          <div class="header-inner">
            <a class="back-link" routerLink="/workflows"><span aria-hidden="true">←</span> Workflows</a>
          </div>
        </lj-box>
      </header>

      @if (loading()) {
        <div class="loading" role="status">
          <span class="loading-mark"></span>
          <p>Loading workflow…</p>
        </div>
      } @else if (error() && !record()) {
        <section class="not-found">
          <p class="eyebrow">Unable to open workflow</p>
          <h1>That workflow is not available.</h1>
          <p>{{ error() }}</p>
          <a routerLink="/workflows">Return to workflows</a>
        </section>
      } @else if (record(); as workflow) {
        <article class="workflow-detail-report report-shell">
          <header class="hero">
            <div class="hero-main">
              <p class="eyebrow">Workflow</p>
              <h1>{{ workflow.name }}</h1>
              <p class="hero-purpose">{{ interpretation()?.summary }}</p>
            </div>
            <div class="hero-side">
              <span class="status" [attr.data-state]="state()">
                <span class="status-dot" aria-hidden="true"></span>
                {{ stateLabel()?.label }}
              </span>
              <p>{{ stateLabel()?.description }}</p>
              <div class="lifecycle-action">
                @if (state() === 'observing') {
                  <button
                    lj-button
                    class="primary"
                    type="button"
                    [disabled]="saving()"
                    (click)="ask('activate')"
                  >
                    {{ saving() ? 'Updating…' : 'Activate workflow' }}
                  </button>
                } @else if (state() === 'active') {
                  <button lj-button type="button" [disabled]="saving()" (click)="ask('pause')">
                    {{ saving() ? 'Updating…' : 'Pause workflow' }}
                  </button>
                } @else {
                  <button
                    lj-button
                    class="primary"
                    type="button"
                    [disabled]="saving()"
                    (click)="ask('resume')"
                  >
                    {{ saving() ? 'Updating…' : 'Resume workflow' }}
                  </button>
                }
              </div>
            </div>
          </header>

          <dl class="facts metadata-strip" aria-label="Workflow activity">
            <div>
              <dt>Last updated</dt>
              <dd>{{ workflow.updatedAt | date: 'MMM d, y · h:mm a' }}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{{ workflow.createdAt | date: 'MMM d, y' }}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{{ workflow.version }}</dd>
            </div>
          </dl>

          <div class="announcements" aria-live="polite">
            @if (workflow.proposalStatus === 'pending') {
              <div class="attention-note">
                <div>
                  <strong>A change is waiting for review.</strong>
                  <span>The current workflow stays in place until a second person approves it.</span>
                </div>
                <a routerLink="/workflows/proposals">Open reviews</a>
              </div>
            }
            @if (notice(); as message) {
              <p class="notice">{{ message }}</p>
            }
            @if (error(); as message) {
              <p class="error" role="alert">{{ message }}</p>
            }
          </div>

          <section class="content-section interpretation-section" aria-labelledby="interpretation-title">
            <div class="section-heading">
              <p class="eyebrow">Interpretation</p>
              <h2 id="interpretation-title">What this workflow does</h2>
              <p>These statements are generated from the exact workflow that runs.</p>
            </div>
            <div class="interpretation-copy">
              <p class="plain-summary">{{ interpretation()?.summary }}</p>
              <ul class="checklist">
                @for (item of interpretation()?.checklist; track $index) {
                  <li><span class="list-mark" aria-hidden="true"></span>{{ item }}</li>
                }
              </ul>
            </div>
          </section>

          @if (simulation(); as sim) {
            <section class="content-section simulation-section" aria-labelledby="simulation-title">
              <div class="section-heading">
                <p class="eyebrow">Test</p>
                <h2 id="simulation-title">How it behaves</h2>
                <p>
                  A repeatable test against {{ sim.tested }} representative requests, with an
                  explanation for every outcome.
                </p>
              </div>
              <div class="simulation-content">
                <div class="simulation-summary" aria-label="Simulation summary">
                  <p><strong>{{ sim.wouldRun }}</strong><span>Would run</span></p>
                  <p><strong>{{ sim.wouldSkip }}</strong><span>Would skip</span></p>
                  <p><strong>{{ sim.needsData }}</strong><span>Could not evaluate</span></p>
                </div>

                <div class="results">
                  @for (result of visibleSimulationResults(); track result.requestId) {
                    <article class="result">
                      <div class="result-heading">
                        <div>
                          <p class="request-id">{{ result.requestId }}</p>
                          <h3>{{ result.requestName }}</h3>
                        </div>
                        <span class="outcome" [attr.data-outcome]="result.outcome">
                          {{ outcomeLabel(result.outcome) }}
                        </span>
                      </div>
                      <p class="explanation">{{ result.explanation }}</p>
                      @if (result.actions.length) {
                        <p class="action-label">It would:</p>
                        <ul class="result-actions">
                          @for (action of result.actions; track $index) {
                            <li>{{ action }}</li>
                          }
                        </ul>
                      }
                      <details>
                        <summary>See the checks behind this result</summary>
                        <ul class="result-checks">
                          @for (check of result.checks; track $index) {
                            <li [attr.data-check]="check.state">
                              <span>{{ checkStateLabel(check.state) }}</span>
                              {{ check.label }}
                            </li>
                          }
                        </ul>
                      </details>
                    </article>
                  }
                </div>
                @if (sim.results.length > 3) {
                  <button type="button" class="show-results" (click)="toggleResults()">
                    {{ showAllResults() ? 'Show fewer results' : 'Show all ' + sim.results.length + ' results' }}
                  </button>
                }
              </div>
            </section>
          }

          <section class="content-section protections-section" aria-labelledby="protections-title">
            <div class="section-heading">
              <p class="eyebrow">Built-in safeguards</p>
              <h2 id="protections-title">Protections applied</h2>
              <p>These safeguards are managed centrally and travel with this workflow.</p>
            </div>
            <ul class="protections-list">
              @for (protection of protections(); track protection.title) {
                <li>
                  <span class="protection-mark" aria-hidden="true"></span>
                  <div>
                    <h3>{{ protection.title }}</h3>
                    <p>{{ protection.description }}</p>
                  </div>
                </li>
              }
            </ul>
          </section>

          @if (canUseInternalTools) {
            <aside class="internal-tools" aria-labelledby="internal-tools-title">
              <div>
                <p class="eyebrow">Internal tools</p>
                <h2 id="internal-tools-title">Structured workflow inspection</h2>
                <p>For authorized operators who need to inspect the rule structure and technical controls.</p>
              </div>
              <a [routerLink]="['/workflows', workflow.id, 'edit']">
                Open internal tools <span aria-hidden="true">→</span>
              </a>
            </aside>
          }
        </article>
      }
    </lj-page>

    @if (confirmation(); as dialog) {
      <sweet-confirmation-dialog
        [open]="true"
        [title]="dialog.title"
        [description]="dialog.description"
        [confirmLabel]="dialog.confirmLabel"
        (confirmed)="confirmLifecycleAction()"
        (cancelled)="confirmation.set(null)"
      />
    }
  `,
  styles: `
    :host { display: block; }
    .page-header { display: block; padding: var(--space-3) 0 0; }
    .header-inner { width: 100%; margin: 0; padding-inline: clamp(24px, 3vw, 40px); }
    .back-link {
      min-height: 36px; display: inline-flex; align-items: center; gap: .55rem; padding: .35rem 0;
      color: var(--text-dim); font-size: var(--text-sm); font-weight: 750; text-decoration: none;
    }
    .back-link:hover { color: var(--text); }
    .workflow-detail-report { overflow: hidden; margin-top: var(--space-2); }
    .hero {
      display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 300px); gap: var(--space-8);
      padding: var(--space-6); border-bottom: 1px solid var(--border); background: var(--surface);
    }
    .hero-main { max-width: 58rem; }
    .hero-main .eyebrow, .section-heading .eyebrow, .internal-tools .eyebrow { margin: 0 0 var(--space-2); }
    .hero h1 {
      margin: 0; font-size: clamp(2rem, 3vw, 2.25rem); line-height: 1.12;
      font-weight: 790; letter-spacing: -.035em; text-wrap: balance;
    }
    .hero-purpose { margin: var(--space-3) 0 0; color: var(--text-dim); font-size: var(--text-sm); line-height: 1.55; }
    .hero-side { align-self: stretch; padding-left: var(--space-6); border-left: 1px solid var(--border); }
    .hero-side > p { margin: var(--space-2) 0 var(--space-4); color: var(--text-dim); font-size: var(--text-xs); line-height: 1.5; }
    .status { min-height: 26px; display: inline-flex; align-items: center; gap: .55rem; padding: 3px 8px; border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--surface-inset); color: var(--text); font-size: var(--text-xs); font-weight: 780; }
    .status-dot { width: .5rem; height: .5rem; border-radius: 50%; background: var(--text-soft); }
    .status[data-state='active'] .status-dot { background: var(--success); }
    .status[data-state='observing'] .status-dot { background: var(--brand); }
    .announcements { padding: var(--space-3) var(--space-6) 0; }
    .announcements:empty { display: none; }
    .attention-note, .notice, .error { border-radius: var(--radius-md); font-size: var(--text-xs); }
    .attention-note {
      display: flex; align-items: center; justify-content: space-between; gap: var(--space-5);
      padding: var(--space-4) var(--space-5); background: var(--warn-bg); color: var(--warn-text);
    }
    .attention-note div { display: flex; flex-direction: column; gap: .15rem; }
    .attention-note a { color: inherit; font-weight: 800; white-space: nowrap; }
    .notice, .error { margin: var(--space-3) 0 0; padding: .8rem 1rem; }
    .notice { background: var(--info-bg); color: var(--info); }
    .error { background: var(--danger-bg); color: var(--danger); }
    .facts { display: flex; border-top: 0; border-bottom: 1px solid var(--border); }
    .facts div { min-width: 11rem; padding: 10px var(--space-6); border-left: 1px solid var(--border); }
    .facts div:first-child { border-left: 0; }
    .facts dt { color: var(--text-soft); font-size: .68rem; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
    .facts dd { margin: .2rem 0 0; color: var(--text); font-size: var(--text-xs); font-weight: 650; }
    .content-section {
      display: grid; grid-template-columns: minmax(180px, .42fr) minmax(0, 1.58fr); gap: var(--space-8);
      padding: var(--space-6); border-top: 1px solid var(--border);
    }
    .section-heading { max-width: 18rem; }
    .section-heading h2, .internal-tools h2 { margin: 0; font-size: 1.05rem; line-height: 1.3; letter-spacing: -.015em; }
    .section-heading > p:not(.eyebrow), .internal-tools p:not(.eyebrow) { margin: var(--space-2) 0 0; color: var(--text-dim); font-size: var(--text-xs); line-height: 1.5; }
    .plain-summary { margin: 0; font-size: var(--text-md); line-height: 1.55; letter-spacing: -.01em; }
    .checklist { list-style: none; margin: var(--space-4) 0 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
    .checklist li { display: flex; gap: var(--space-3); padding: 10px var(--space-3); border-top: 1px solid var(--border); color: var(--text-dim); font-size: var(--text-sm); }
    .checklist li:first-child { border-top: 0; }
    .list-mark { width: 8px; height: 8px; flex: none; margin-top: 6px; border: 2px solid var(--brand); border-radius: 50%; }
    .simulation-summary { display: flex; margin-bottom: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
    .simulation-summary p { flex: 1; margin: 0; padding: var(--space-3); border-left: 1px solid var(--border); }
    .simulation-summary p:first-child { border-left: 0; }
    .simulation-summary strong { display: block; font-size: 1.35rem; line-height: 1; }
    .simulation-summary span { display: block; margin-top: var(--space-1); color: var(--text-dim); font-size: 10px; font-weight: 750; }
    .results { border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
    .result { padding: var(--space-3) var(--space-4); border-top: 1px solid var(--border); }
    .result:first-child { border-top: 0; }
    .result-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
    .request-id { margin: 0 0 .2rem; color: var(--text-soft); font-size: .67rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .result h3 { margin: 0; font-size: 1.05rem; }
    .outcome { padding: .28rem .7rem; border-radius: var(--radius-pill); background: var(--surface-inset); color: var(--text-dim); font-size: .7rem; font-weight: 800; white-space: nowrap; }
    .outcome[data-outcome='run'] { background: var(--success-bg); color: var(--success); }
    .outcome[data-outcome='needs_data'] { background: var(--warn-bg); color: var(--warn-text); }
    .explanation { margin: var(--space-2) 0 0; color: var(--text-dim); font-size: var(--text-sm); line-height: 1.5; }
    .action-label { margin: var(--space-4) 0 .25rem; color: var(--text-soft); font-size: var(--text-xs); font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
    .result-actions { margin: 0; padding-left: 1.2rem; color: var(--text); }
    .result details { margin-top: var(--space-4); }
    .result summary { width: fit-content; color: var(--brand-text); font-size: var(--text-xs); font-weight: 750; cursor: pointer; }
    .result-checks { list-style: none; margin: var(--space-3) 0 0; padding: 0; }
    .result-checks li { display: flex; gap: .6rem; padding: .35rem 0; color: var(--text-dim); font-size: var(--text-xs); }
    .result-checks li span { min-width: 7rem; color: var(--text); font-weight: 750; }
    .result-checks li[data-check='missing'] span { color: var(--warn-text); }
    .show-results { min-height: 42px; margin-top: var(--space-5); padding: .6rem 0; border: 0; background: transparent; color: var(--brand-text); font: inherit; font-size: var(--text-sm); font-weight: 800; cursor: pointer; }
    .show-results:hover { text-decoration: underline; text-underline-offset: .25rem; }
    .protections-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
    .protections-list li { display: flex; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-top: 1px solid var(--border); }
    .protections-list li:first-child { border-top: 0; }
    .protection-mark { flex: 0 0 auto; width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--brand); }
    .protections-list h3 { margin: 0; font-size: var(--text-sm); }
    .protections-list p { margin: .2rem 0 0; color: var(--text-dim); font-size: var(--text-xs); line-height: 1.5; }
    .internal-tools { display: flex; align-items: center; justify-content: space-between; gap: var(--space-8); padding: var(--space-4) var(--space-6); border-top: 1px solid var(--border); background: var(--surface-inset); }
    .internal-tools > div { max-width: 42rem; }
    .internal-tools h2 { font-size: 1.25rem; }
    .internal-tools a { flex: 0 0 auto; color: var(--brand-text); font-weight: 800; text-decoration: none; }
    .internal-tools a:hover { text-decoration: underline; text-underline-offset: .25rem; }
    .loading, .not-found { max-width: 42rem; padding: var(--space-20) 0; }
    .loading { display: flex; align-items: center; gap: var(--space-3); color: var(--text-dim); }
    .loading-mark { width: .7rem; height: .7rem; border-radius: 50%; background: var(--brand); animation: pulse 900ms ease-in-out infinite alternate; }
    .loading p { margin: 0; }
    .not-found h1 { margin: 0; font-size: clamp(2rem, 5vw, 3.8rem); letter-spacing: -.045em; }
    .not-found > p:not(.eyebrow) { color: var(--text-dim); }
    .not-found a { color: var(--brand-text); font-weight: 750; }
    @keyframes pulse { to { opacity: .3; transform: scale(.75); } }
    @media (max-width: 820px) {
      .hero { grid-template-columns: 1fr; gap: var(--space-4); }
      .hero-side { max-width: 28rem; }
      .hero-side { padding: var(--space-4) 0 0; border-top: 1px solid var(--border); border-left: 0; }
      .content-section { grid-template-columns: 1fr; gap: var(--space-4); }
      .section-heading { max-width: 35rem; }
    }
    @media (max-width: 560px) {
      .hero { padding: var(--space-4); }
      .facts { display: grid; grid-template-columns: 1fr 1fr; row-gap: var(--space-5); }
      .facts div { min-width: 0; padding-inline: 0 var(--space-4); border-left: 0; }
      .facts div:last-child { grid-column: 1 / -1; }
      .attention-note, .internal-tools { align-items: flex-start; flex-direction: column; }
      .simulation-summary { display: grid; grid-template-columns: repeat(3, 1fr); }
      .simulation-summary p { padding: var(--space-4) var(--space-3); }
      .result-heading { align-items: flex-start; flex-direction: column; }
      .result-checks li { flex-direction: column; gap: .1rem; }
      .announcements { padding-inline: var(--space-4); }
      .content-section { padding: var(--space-4); }
      .internal-tools { padding: var(--space-4); }
    }
    @media (prefers-reduced-motion: reduce) { .loading-mark { animation: none; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkflowDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(WorkflowsService);
  private readonly accessPolicy = inject(WORKFLOW_ACCESS_POLICY);

  protected readonly canUseInternalTools = this.accessPolicy.canUseInternalTools;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly record = signal<WorkflowRecord | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmation = signal<DetailConfirmation | null>(null);
  protected readonly showAllResults = signal(false);

  protected readonly state = computed(() => {
    const record = this.record();
    return record ? workflowState(record) : null;
  });
  protected readonly stateLabel = computed(() => {
    const state = this.state();
    return state ? STATE_LABELS[state] : null;
  });
  protected readonly interpretation = computed(() => {
    const record = this.record();
    return record ? interpretRule(record.ruleJson) : null;
  });
  protected readonly simulation = computed(() => {
    const record = this.record();
    return record ? explainSimulation(record.ruleJson) : null;
  });
  protected readonly protections = computed(() => {
    const record = this.record();
    return record ? protectionsFor(record.ruleJson) : [];
  });
  protected readonly visibleSimulationResults = computed<ExplainedResult[]>(() => {
    const results = this.simulation()?.results ?? [];
    return this.showAllResults() ? results : results.slice(0, 3);
  });

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('No workflow was selected.');
      this.loading.set(false);
      return;
    }
    this.service.get(id).subscribe({
      next: (record) => {
        this.record.set(record);
        this.loading.set(false);
      },
      error: (error: Error) => {
        this.error.set(error.message || 'The workflow could not be loaded.');
        this.loading.set(false);
      },
    });
  }

  protected outcomeLabel(outcome: SimOutcome) {
    if (outcome === 'run') return 'Would run';
    if (outcome === 'needs_data') return 'Could not evaluate';
    return 'Would skip';
  }

  protected checkStateLabel(state: ExplainedResult['checks'][number]['state']) {
    if (state === 'matched') return 'Matched';
    if (state === 'missing') return 'Information missing';
    return 'Did not match';
  }

  protected toggleResults() {
    this.showAllResults.update((value) => !value);
  }

  protected ask(action: LifecycleAction) {
    const record = this.record();
    if (!record) return;
    this.notice.set(null);
    this.error.set(null);
    const blocker = this.activationIssue(action, record);
    if (blocker) {
      this.reportActivationBlock(blocker);
      return;
    }
    if (action === 'activate') {
      this.confirmation.set({
        action,
        title: `Activate “${record.name}”?`,
        description:
          'This workflow will stop observing and begin taking real actions. Some organizations require a second reviewer before activation.',
        confirmLabel: 'Activate workflow',
      });
      return;
    }
    if (action === 'pause') {
      this.confirmation.set({
        action,
        title: `Pause “${record.name}”?`,
        description: 'The workflow will stop watching requests and taking actions until it is resumed.',
        confirmLabel: 'Pause workflow',
      });
      return;
    }
    this.confirmation.set({
      action,
      title: `Resume “${record.name}”?`,
      description:
        record.ruleJson.controls.mode === 'armed'
          ? 'The workflow will return to active operation and begin taking real actions again.'
          : 'The workflow will return to observation and continue recording what it would do.',
      confirmLabel: 'Resume workflow',
    });
  }

  protected confirmLifecycleAction() {
    const pending = this.confirmation();
    const record = this.record();
    if (!pending || !record) return;
    const blocker = this.activationIssue(pending.action, record);
    if (blocker) {
      this.confirmation.set(null);
      this.reportActivationBlock(blocker);
      return;
    }
    this.confirmation.set(null);
    this.saving.set(true);

    if (pending.action === 'activate') {
      const ruleJson = {
        ...record.ruleJson,
        controls: { ...record.ruleJson.controls, mode: 'armed' as const },
      };
      this.service
        .update(record.id, {
          name: record.name,
          description: record.description,
          ruleJson,
          expectedVersion: record.version,
        })
        .subscribe({
          next: (outcome) => this.applyOutcome(outcome, pending.action),
          error: (error: Error) => this.fail(error),
        });
      return;
    }

    this.service.toggle(record.id, pending.action === 'resume').subscribe({
      next: (outcome) => this.applyOutcome(outcome, pending.action),
      error: (error: Error) => this.fail(error),
    });
  }

  private applyOutcome(outcome: SaveOutcome, action: LifecycleAction) {
    this.record.set(outcome.record);
    this.saving.set(false);
    if (outcome.kind === 'proposed') {
      this.notice.set('This change was sent for review. The current workflow remains in place for now.');
      return;
    }
    const verb = action === 'activate' ? 'active' : action === 'pause' ? 'paused' : 'resumed';
    this.notice.set(`The workflow is now ${verb}.`);
  }

  private activationIssue(action: LifecycleAction, record: WorkflowRecord): string | null {
    const startsLiveActions =
      action === 'activate' ||
      (action === 'resume' && record.ruleJson.controls.mode === 'armed');
    return startsLiveActions ? activationBlocker(record.ruleJson) : null;
  }

  private reportActivationBlock(reason: string) {
    this.error.set(
      `This workflow cannot be activated yet. ${reason} Open Internal tools to review it before trying again.`
    );
  }

  private fail(error: Error) {
    this.saving.set(false);
    this.error.set(error.message || 'That change could not be completed.');
  }
}
