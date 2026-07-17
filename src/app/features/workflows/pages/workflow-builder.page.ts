import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { interval } from 'rxjs';
import {
  FIELDS,
  WorkflowRule,
  emptyRule,
  getEvent,
  opLabel,
  condFieldKind,
  condFieldLabel,
  getAction,
  isValuelessOperator,
  paramKeyFor,
  scopeLabel,
  walkLeaves,
} from '../../../core/vocabulary';
import { RuleIssue } from '../../../core/ruleValidation';
import { LintContext, hasBlockingIssues, lintRule } from '../../../core/ruleLinter';
import { ParseResult } from '../../../core/nlParser';
import { parseGateIssues } from '../../../core/parseGate';
import { shouldProposeWorkflowWrite } from '../../../core/fourEyes';
import { VocabularyService } from '../ui/vocabulary-chip';
import { CacheService, DRAFT_AUTOSAVE_MS, NEW_WORKFLOW_ID, WORKFLOW_DRAFTS_KEY } from '../../../shared/cache.service';
import { ConfirmationDialog } from '../../../shared/confirmation-dialog';
import { LJ_PRIMITIVES } from '../../../shared/lj/lj';
import { SaveOutcome, WorkflowsService } from '../data/workflows.service';
import { WORKFLOW_ACCESS_POLICY } from '../data/workflow-access-policy';
import { ChatDraft } from '../ui/chat-draft';
import { ControlsPanel } from '../ui/controls-panel';
import { IssuesPanel } from '../ui/issues-panel';
import { JsonEditor } from '../ui/json-editor';
import { RuleSentence } from '../ui/rule-sentence';
import { SimulationPanel } from '../ui/simulation-panel';

interface DraftEnvelope {
  rule: WorkflowRule;
  name: string;
  savedAt: string;
  /** Optional for backward compatibility with envelopes saved before provenance persistence. */
  parseMeta?: ParseResult | null;
}

/**
 * The builder page: Dynamic-Form-builder chrome (Back / History placeholder /
 * Design–JSON toggle / Save), chat drafting, the WHEN/IF/THEN sentence,
 * safety controls, and the shared lint pipeline (validation + semantic linter)
 * gating save on blocking findings. Drafts auto-save to localStorage every 2s
 * (admin draft contract) keyed by id or NEW_WORKFLOW_ID.
 */
@Component({
  selector: 'wf-workflow-builder-page',
  imports: [
    ...LJ_PRIMITIVES,
    RuleSentence,
    ControlsPanel,
    IssuesPanel,
    ChatDraft,
    JsonEditor,
    SimulationPanel,
    ConfirmationDialog,
  ],
  template: `
    <lj-page>
      <header header class="page-header">
        <div class="header-top">
          <button type="button" class="back" (click)="back()">← Workflows</button>
          <span class="internal-label">Internal workspace</span>
        </div>

        <div class="title-row">
          <div class="title-control">
            <label for="workflow-name">Workflow name</label>
            <input
              id="workflow-name"
              class="name"
              type="text"
              [value]="name()"
              (input)="rename($any($event.target).value)"
              placeholder="Workflow name"
              autocomplete="off"
            />
            <p class="workflow-state">
              <span
                class="state-dot"
                [class.active]="enabled() && rule().controls.mode === 'armed'"
                [class.paused]="!enabled()"
                aria-hidden="true"
              ></span>
              <strong>{{ statusLabel() }}</strong>
              <span>· {{ statusDescription() }}</span>
            </p>
          </div>

          <div class="page-actions">
            @if (!isNew()) {
              <button lj-button class="danger" [disabled]="deleting()" (click)="remove()">Delete</button>
            }
            <button lj-button class="primary" [disabled]="saving() || deleting() || hasErrors()" (click)="save()">
              {{ primaryActionLabel() }}
            </button>
          </div>
        </div>
      </header>

      <div class="notices" aria-live="polite">
        @if (pendingProposal()) {
          <div class="notice pending">
            <span class="notice-mark" aria-hidden="true">↗</span>
            <span>
              <b>This update is waiting for a second reviewer.</b>
              The current workflow has not changed.
            </span>
            <button type="button" (click)="goProposals()">Open review queue</button>
          </div>
        }
        @if (draftBanner(); as draft) {
          <div class="notice restore">
            <span class="notice-mark" aria-hidden="true">_</span>
            <span>An unsaved draft from {{ draft.savedAt.slice(11, 16) }} is available.</span>
            <span class="notice-actions">
              <button type="button" (click)="restoreDraft()">Restore</button>
              <button type="button" (click)="discardDraft()">Discard</button>
            </span>
          </div>
        }
        @if (parseGapCount(); as gaps) {
          <div class="notice attention">
            <span class="notice-mark" aria-hidden="true">!</span>
            <span>
              Sweet needs {{ gaps }} more detail{{ gaps === 1 ? '' : 's' }} before this workflow
              can be updated. Open Internal tools for the full checklist.
            </span>
          </div>
        }
        @if (error(); as message) {
          <div class="notice error" role="alert">
            <span class="notice-mark" aria-hidden="true">!</span>
            <span>{{ message }}</span>
          </div>
        }
      </div>

      @if (loading()) {
        <p class="state" aria-live="polite">Loading workflow…</p>
      } @else {
        <article class="workspace">
          <section class="overview" aria-labelledby="interpretation-heading">
            <p class="eyebrow">Plain-language interpretation</p>
            <h1 id="interpretation-heading">{{ summary() }}</h1>
            <div
              class="readiness"
              [class.needs-attention]="hasErrors()"
              role="status"
            >
              <span class="readiness-dot" aria-hidden="true"></span>
              @if (hasErrors()) {
                <span>
                  Needs {{ blockingIssueCount() }} change{{ blockingIssueCount() === 1 ? '' : 's' }}
                  before it can be updated.
                </span>
              } @else {
                <span>The definition is complete and ready to test.</span>
              }
            </div>

            <details class="protections">
              <summary>Protections applied</summary>
              <p>
                Duplicate prevention, safe handling of missing data, activity monitoring, and
                automatic pausing for unusual volume.
              </p>
            </details>
          </section>

          <section class="section-block section-grid" aria-labelledby="revise-heading">
            <div class="section-heading">
              <p class="eyebrow">Refine</p>
              <h2 id="revise-heading">Revise in plain language</h2>
              <p>Describe what should change. Sweet will rebuild and check the definition.</p>
            </div>
            <div class="section-content">
              <wf-chat-draft (drafted)="applyDraftedRule($event)" />
            </div>
          </section>

          @if (hasMeaningfulDraft()) {
            <section class="section-block section-grid" aria-labelledby="test-heading">
              <div class="section-heading">
                <p class="eyebrow">Test</p>
                <h2 id="test-heading">Try a request</h2>
                <p>See whether this workflow would run, skip, or need more information.</p>
              </div>
              <div class="section-content">
                <wf-simulation-panel [rule]="rule()" />
              </div>
            </section>
          }

          <details class="internal-tools">
            <summary>
              <span>
                <span class="eyebrow">Restricted</span>
                <strong>Internal tools</strong>
                <small>Technical definition, policies, and diagnostics</small>
              </span>
              <span class="tool-summary-end">
                @if (blockingIssueCount()) {
                  <span class="tool-status">{{ blockingIssueCount() }} blocking</span>
                }
                <span class="chevron" aria-hidden="true">+</span>
              </span>
            </summary>

            <div class="internal-body">
              <div class="internal-nav" role="group" aria-label="Internal editor view">
                <button type="button" [class.active]="view() === 'design'" (click)="view.set('design')">
                  Visual definition
                </button>
                <button type="button" [class.active]="view() === 'json'" (click)="view.set('json')">
                  Rule data
                </button>
              </div>

              @if (view() === 'design') {
                <section class="technical-section">
                  <div class="technical-heading">
                    <h3>Deterministic definition</h3>
                    <p>The structured model used by validation and runtime evaluation.</p>
                  </div>
                  <wf-rule-sentence [rule]="rule()" (ruleChange)="setRule($event)" />
                </section>

                <section class="technical-section">
                  <div class="technical-heading">
                    <h3>Operational policies</h3>
                    <p>Internal execution safeguards. These are not client-facing settings.</p>
                  </div>
                  <wf-controls-panel [controls]="rule().controls" (controlsChange)="setControls($event)" />
                </section>
              } @else {
                <section class="technical-section">
                  <div class="technical-heading">
                    <h3>Rule data</h3>
                    <p>Restricted direct editing. Changes are validated before they can be applied.</p>
                  </div>
                  <wf-json-editor [rule]="rule()" (applied)="setRule($event)" />
                </section>
              }

              <section class="technical-section diagnostics">
                <div class="technical-heading">
                  <h3>Diagnostics</h3>
                  <p>Validation and reference checks for internal operators.</p>
                </div>
                <wf-issues-panel [issues]="issues()" />
              </section>
            </div>
          </details>
        </article>
      }

      <sweet-confirmation-dialog
        [open]="deleteOpen()"
        title="Delete this workflow?"
        [description]="'“' + name() + '” will be permanently removed. This cannot be undone.'"
        confirmLabel="Delete workflow"
        [danger]="true"
        (confirmed)="confirmRemove()"
        (cancelled)="cancelRemove()"
      />
    </lj-page>
  `,
  styles: `
    .page-header {
      width: min(100%, 1240px); margin: 0 auto;
      padding: var(--space-8) clamp(1rem, 3vw, 3rem) var(--space-10);
      border-bottom: 1px solid var(--border);
    }
    .header-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
    .back {
      min-height: 42px; padding: 0; border: 0; background: transparent;
      color: var(--text-dim); font-weight: 750; cursor: pointer;
    }
    .back:hover { color: var(--text); }
    .internal-label {
      color: var(--text-soft); font-size: .68rem; font-weight: 800;
      letter-spacing: .12em; text-transform: uppercase;
    }
    .title-row {
      display: flex; align-items: end; justify-content: space-between; gap: var(--space-10);
      margin-top: var(--space-8);
    }
    .title-control { min-width: 0; flex: 1; }
    .title-control > label {
      display: block; margin-bottom: var(--space-2); color: var(--text-soft);
      font-size: .68rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
    }
    .name {
      display: block; width: min(100%, 46rem); min-width: 0; padding: 0 0 var(--space-2);
      border: 0; border-bottom: 1px solid transparent; border-radius: 0;
      outline: none; color: var(--text); background: transparent;
      font-size: clamp(2rem, 5vw, 4.25rem); font-weight: 780; line-height: 1.04; letter-spacing: -.055em;
    }
    .name:hover { border-bottom-color: var(--border); }
    .name:focus { border-bottom-color: var(--brand); }
    .workflow-state { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-3) 0 0; color: var(--text-dim); font-size: var(--text-sm); }
    .workflow-state strong { color: var(--text); }
    .state-dot, .readiness-dot {
      width: .55rem; height: .55rem; flex: 0 0 auto; border-radius: 50%; background: var(--warn);
    }
    .state-dot.active { background: var(--success); }
    .state-dot.paused { background: var(--text-soft); }
    .page-actions { display: flex; align-items: center; gap: var(--space-3); flex: 0 0 auto; }
    .notices { width: min(100%, 1240px); margin: 0 auto; padding-inline: clamp(1rem, 3vw, 3rem); }
    .notice {
      display: flex; align-items: center; gap: var(--space-3);
      padding: var(--space-4) 0; border-bottom: 1px solid var(--border);
      color: var(--text-dim); font-size: var(--text-sm);
    }
    .notice b { color: var(--text); }
    .notice-mark {
      display: grid; place-items: center; width: 1.55rem; height: 1.55rem; flex: 0 0 auto;
      border-radius: 50%; color: var(--brand-text); background: var(--info-bg); font-size: .72rem; font-weight: 900;
    }
    .notice.attention .notice-mark { color: var(--warn-text); background: var(--warn-bg); }
    .notice.error .notice-mark { color: var(--danger); background: var(--danger-bg); }
    .notice.error { color: var(--danger); }
    .notice button {
      min-height: 36px; margin-left: auto; padding: .4rem .75rem;
      border: 0; border-radius: var(--radius-pill); background: transparent;
      color: var(--brand-text); font-weight: 750; cursor: pointer;
    }
    .notice button:hover { background: var(--surface-inset); }
    .notice-actions { display: flex; align-items: center; margin-left: auto; }
    .notice-actions button { margin-left: 0; }
    .state { color: var(--text-dim); padding: var(--space-16) 0; }
    .workspace { max-width: 1040px; margin: 0 auto; }
    .overview { padding: clamp(3rem, 8vw, 7rem) 0 clamp(3rem, 7vw, 6rem); }
    .overview > .eyebrow { margin: 0 0 var(--space-5); }
    .overview h1 {
      max-width: 52rem; margin: 0;
      font-size: clamp(2rem, 4.6vw, 4.25rem); line-height: 1.08; font-weight: 680; letter-spacing: -.045em;
    }
    .readiness { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-8); color: var(--success); font-size: var(--text-sm); font-weight: 700; }
    .readiness-dot { background: var(--success); }
    .readiness.needs-attention { color: var(--warn-text); }
    .readiness.needs-attention .readiness-dot { background: var(--warn); }
    .protections { max-width: 48rem; margin-top: var(--space-8); color: var(--text-dim); font-size: var(--text-sm); }
    .protections summary { width: fit-content; color: var(--text); font-weight: 750; cursor: pointer; }
    .protections p { margin: var(--space-3) 0 0; line-height: 1.7; }
    .section-block { padding: clamp(2.75rem, 6vw, 5rem) 0; border-top: 1px solid var(--border); }
    .section-grid { display: grid; grid-template-columns: minmax(12rem, .72fr) minmax(0, 1.65fr); gap: clamp(2rem, 6vw, 6rem); }
    .section-heading .eyebrow { margin: 0 0 var(--space-3); }
    .section-heading h2 { margin: 0; font-size: clamp(1.55rem, 3vw, 2.35rem); line-height: 1.12; letter-spacing: -.035em; }
    .section-heading > p:last-child { margin: var(--space-4) 0 0; color: var(--text-dim); line-height: 1.65; }
    .section-content { min-width: 0; }
    .internal-tools { border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
    .internal-tools > summary {
      min-height: 7.5rem; display: flex; align-items: center; justify-content: space-between; gap: var(--space-6);
      padding: var(--space-6) 0; cursor: pointer; list-style: none;
    }
    .internal-tools > summary::-webkit-details-marker { display: none; }
    .internal-tools > summary > span:first-child { display: grid; gap: var(--space-1); }
    .internal-tools summary .eyebrow { margin: 0; }
    .internal-tools summary strong { font-size: var(--text-lg); }
    .internal-tools summary small { color: var(--text-dim); font-size: var(--text-sm); font-weight: 400; }
    .tool-summary-end { display: flex; align-items: center; gap: var(--space-4); }
    .tool-status { color: var(--danger); font-size: var(--text-xs); font-weight: 800; }
    .chevron { color: var(--brand-text); font-size: 1.6rem; font-weight: 350; transition: transform var(--motion-medium) var(--ease-settle); }
    .internal-tools[open] .chevron { transform: rotate(45deg); }
    .internal-body { padding: 0 0 var(--space-10); }
    .internal-nav {
      display: inline-flex; margin-bottom: var(--space-8); padding: var(--space-1);
      border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--surface-inset);
    }
    .internal-nav button {
      min-height: 38px; padding: .5rem .9rem; border: 0; border-radius: var(--radius-pill);
      background: transparent; color: var(--text-dim); font-size: var(--text-xs); font-weight: 750; cursor: pointer;
    }
    .internal-nav button.active { color: var(--text); background: var(--surface); box-shadow: 0 1px 4px rgb(17 19 21 / .08); }
    .technical-section { padding: var(--space-8) 0; border-top: 1px solid var(--border); }
    .technical-heading { display: grid; grid-template-columns: minmax(10rem, .72fr) minmax(0, 1.65fr); gap: clamp(2rem, 6vw, 6rem); margin-bottom: var(--space-8); }
    .technical-heading h3 { margin: 0; font-size: var(--text-lg); }
    .technical-heading p { margin: 0; color: var(--text-dim); font-size: var(--text-sm); }
    @media (max-width: 800px) {
      .title-row { align-items: flex-start; flex-direction: column; }
      .page-actions { align-self: stretch; justify-content: flex-end; }
      .section-grid, .technical-heading { grid-template-columns: 1fr; gap: var(--space-8); }
    }
    @media (max-width: 560px) {
      .page-header { padding-top: var(--space-5); padding-bottom: var(--space-8); }
      .title-row { margin-top: var(--space-6); }
      .name { font-size: 2.2rem; }
      .workflow-state { align-items: flex-start; flex-wrap: wrap; }
      .page-actions { display: grid; grid-template-columns: 1fr; width: 100%; }
      .page-actions button { width: 100%; }
      .notice { align-items: flex-start; flex-wrap: wrap; }
      .notice button, .notice-actions { margin-left: 2.3rem; }
      .notice-actions { width: calc(100% - 2.3rem); }
      .notice-actions button { margin-left: 0; }
      .overview { padding-block: var(--space-12); }
      .overview h1 { font-size: 2rem; }
      .section-block { padding-block: var(--space-10); }
      .internal-tools > summary { min-height: 6.5rem; }
      .tool-summary-end { gap: var(--space-2); }
      .tool-status { display: none; }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkflowBuilderPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(WorkflowsService);
  private readonly cache = inject(CacheService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly accessPolicy = inject(WORKFLOW_ACCESS_POLICY);

  private readonly id: string = this.route.snapshot.paramMap.get('id') ?? 'new';
  protected readonly isNew = signal(this.id === 'new');

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly deleting = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly view = signal<'design' | 'json'>('design');
  protected readonly name = signal('New workflow');
  protected readonly rule = signal<WorkflowRule>(emptyRule());
  protected readonly draftBanner = signal<DraftEnvelope | null>(null);
  protected readonly pendingProposal = signal<string | null>(null);
  protected readonly enabled = signal(true);

  /** Server-side state at load, for the four-eyes gate preview. */
  private readonly baselineRule = signal<WorkflowRule | null>(null);
  private readonly baselineEnabled = signal(true);

  private version: number | undefined;
  private dirty = false;

  /**
   * Peer workflows for the linter's OVERLAP check (the rule under edit is
   * excluded). Loaded once, best-effort: if the list fails, lint runs without
   * peers — reference checks are skipped by contract, never falsely raised.
   */
  private readonly lintPeers = signal<LintContext['peers']>(undefined);

  private readonly vocab = inject(VocabularyService);

  /**
   * Live registries for the linter's reference checks (Phase B2). Empty in
   * mock mode — the linter skips checks whose registry is absent, so the
   * demo never raises false BROKEN_REF/MISSING_DATA_EXPOSURE findings.
   *
   * `liveFieldKeys` carries `condFieldKey` outputs: platform field keys pass
   * verbatim (they are intrinsic to requests, not template-driven) plus the
   * `ff:` composites actually fetched — so only form-field refs against
   * unknown templates warn. (The Next-track caller passed bare fieldIds,
   * which could never match a composite — fixed here.)
   */
  private readonly lintRegistries = computed<Partial<LintContext>>(() => {
    if (this.vocab.source() === 'static') return {};
    const asRegistry = (options: { value: string; label: string }[]) =>
      options.map((option) => ({ id: option.value, label: option.label }));
    const composites = this.vocab
      .liveFieldsRaw()
      .map((f: { formTemplateId: string; fieldId: string }) => `ff:${f.formTemplateId}:${f.fieldId}`);
    return {
      stages: asRegistry(this.vocab.liveStages()),
      users: asRegistry(this.vocab.liveUsers()),
      retailers: asRegistry(this.vocab.liveRetailers()),
      templates: this.vocab.liveTemplateIds(),
      liveFieldKeys: composites.length ? [...Object.keys(FIELDS), ...composites] : [],
    };
  });

  /**
   * Parse provenance (composer roadmap MVP 1): the full ParseResult behind
   * the current rule when it came from the chat draft. Its sidecar gaps
   * (unresolved/uncovered/ambiguous) become blocking issues below, so an
   * incomplete parse can never read as "No lint issues". Manual and policy
   * edits rebind the result to the new rule but retain its sidecar gaps: an
   * edit must not erase unresolved source language without an explicit reparse.
   */
  private readonly parseMeta = signal<ParseResult | null>(null);
  protected readonly parseGapCount = computed(() => {
    const meta = this.parseMeta();
    return meta ? parseGateIssues(meta).length : 0;
  });

  /**
   * Full lint pipeline: parse-coverage gate (MVP 1) layered over shared-core
   * validation and the semantic linter — peers for OVERLAP (B1), live
   * registries for reference checks (B2). Parse gaps list first: they explain
   * WHY the rule is incomplete before lint explains what's wrong with it.
   */
  protected readonly issues = computed<RuleIssue[]>(() => {
    const meta = this.parseMeta();
    return [
      ...(meta ? parseGateIssues(meta) : []),
      ...lintRule(this.rule(), { peers: this.lintPeers(), ...this.lintRegistries() }).issues,
    ];
  });
  protected readonly hasErrors = computed(() => hasBlockingIssues(this.issues()));
  protected readonly blockingIssueCount = computed(
    () => this.issues().filter((issue) => issue.severity === 'error').length
  );
  protected readonly hasMeaningfulDraft = computed(() => this.rule().actions.length > 0);
  protected readonly statusLabel = computed(() => {
    if (!this.enabled()) return 'Paused';
    return this.rule().controls.mode === 'armed' ? 'Active' : 'Observing';
  });
  protected readonly statusDescription = computed(() => {
    if (!this.enabled()) return 'Not watching or taking action';
    return this.rule().controls.mode === 'armed'
      ? 'Actions can run for matching requests'
      : 'Testing without taking live action';
  });

  /**
   * Will this save land as a proposal? Same shared-core gate the service
   * enforces — the button label states what will actually happen (§2.3).
   */
  protected readonly wouldPropose = computed(() => {
    const baseline = this.baselineRule();
    if (this.isNew() || !baseline) return false;
    return shouldProposeWorkflowWrite({
      currentRule: baseline,
      currentEnabled: this.baselineEnabled(),
      nextRule: this.rule(),
    });
  });

  protected readonly primaryActionLabel = computed(() => {
    if (this.saving()) return this.isNew() ? 'Creating…' : 'Updating…';
    if (this.isNew()) return 'Create workflow';
    return this.wouldPropose() ? 'Submit for review' : 'Update workflow';
  });

  protected readonly summary = computed(() => {
    const rule = this.rule();
    const whenPart = rule.triggers
      .map((t) => (getEvent(t.event)?.label ?? t.event).toLocaleLowerCase())
      .join(' or ');
    const leaves = walkLeaves(rule.conditions);
    const ifPart = leaves
      .map((leaf) => {
        const op = opLabel(condFieldKind(leaf.field), leaf.operator);
        const value = isValuelessOperator(leaf.operator) ? '' : ` ${scopeLabel(leaf.value)}`;
        return `${condFieldLabel(leaf.field)} ${op}${value}`;
      })
      .join(rule.conditions.logic === 'OR' ? ' or ' : ' and ');
    const thenPart = rule.actions
      .map((output) => {
        const def = getAction(output.action);
        const param = def?.paramKind === 'none' ? '' : ` ${scopeLabel(output.params[paramKeyFor(output.action)]) || '…'}`;
        return `${(def?.label ?? output.action).toLocaleLowerCase()}${param}`;
      })
      .join(' and ');
    const otherwisePart = (rule.else ?? [])
      .map((output) => {
        const def = getAction(output.action);
        const param = def?.paramKind === 'none' ? '' : ` ${scopeLabel(output.params[paramKeyFor(output.action)]) || '…'}`;
        return `${(def?.label ?? output.action).toLocaleLowerCase()}${param}`;
      })
      .join(' and ');
    if (!thenPart) return 'This workflow does not have an outcome yet.';
    return `When ${whenPart || 'the starting event occurs'}${ifPart ? ` and ${ifPart}` : ''}, Sweet will ${thenPart}.${
      otherwisePart ? ` Otherwise, Sweet will ${otherwisePart}.` : ''
    }`;
  });

  private get draftKey(): string {
    return this.isNew() ? NEW_WORKFLOW_ID : this.id;
  }

  constructor() {
    this.load();
    this.loadLintPeers();
    // Admin draft contract: steady 2s autosave of dirty state.
    interval(DRAFT_AUTOSAVE_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.persistDraft());
  }

  private loadLintPeers() {
    this.service.list().subscribe({
      next: (records) =>
        this.lintPeers.set(
          records
            .filter((record) => record.id !== this.id)
            .map((record) => ({
              id: record.id,
              name: record.name,
              rule: record.ruleJson,
              enabled: record.enabled,
            }))
        ),
      // Best-effort: no peers just means the OVERLAP check is skipped.
      error: () => this.lintPeers.set(undefined),
    });
  }

  private load() {
    const drafts = this.cache.read<Record<string, DraftEnvelope>>(WORKFLOW_DRAFTS_KEY) ?? {};
    if (this.isNew()) {
      const draft = drafts[NEW_WORKFLOW_ID];
      if (draft) this.draftBanner.set(draft);
      this.loading.set(false);
      return;
    }
    this.service.get(this.id).subscribe({
      next: (record) => {
        this.name.set(record.name);
        this.rule.set(record.ruleJson);
        this.version = record.version;
        this.baselineRule.set(record.ruleJson);
        this.baselineEnabled.set(record.enabled);
        this.enabled.set(record.enabled);
        this.pendingProposal.set(record.pendingProposalId ?? null);
        const draft = drafts[this.id];
        if (draft && draft.savedAt > record.updatedAt) this.draftBanner.set(draft);
        this.loading.set(false);
      },
      error: (error: Error) => {
        this.error.set(error.message);
        this.loading.set(false);
      },
    });
  }

  protected setRule(rule: WorkflowRule) {
    this.rule.set(rule);
    this.dirty = true;
    this.rebindParseMeta(rule);
  }
  protected setControls(controls: WorkflowRule['controls']) {
    this.setRule({ ...this.rule(), controls });
  }
  protected applyDraftedRule(result: ParseResult) {
    if (!result.rule) return;
    this.rule.set(result.rule);
    this.dirty = true;
    this.parseMeta.set(result);
  }
  protected rename(name: string) {
    this.name.set(name);
    this.dirty = true;
  }

  /** Keep parser sidecars blocking while ensuring their rule reference is current. */
  private rebindParseMeta(rule: WorkflowRule) {
    const meta = this.parseMeta();
    if (meta) this.parseMeta.set({ ...meta, rule });
  }

  private persistDraft() {
    if (!this.dirty) return;
    const drafts = this.cache.read<Record<string, DraftEnvelope>>(WORKFLOW_DRAFTS_KEY) ?? {};
    drafts[this.draftKey] = {
      rule: this.rule(),
      name: this.name(),
      savedAt: new Date().toISOString(),
      parseMeta: this.parseMeta(),
    };
    this.cache.write(WORKFLOW_DRAFTS_KEY, drafts);
  }

  protected restoreDraft() {
    const draft = this.draftBanner();
    if (!draft) return;
    this.rule.set(draft.rule);
    this.name.set(draft.name);
    this.parseMeta.set(draft.parseMeta ? { ...draft.parseMeta, rule: draft.rule } : null);
    this.draftBanner.set(null);
    this.dirty = true;
  }

  protected discardDraft() {
    this.draftBanner.set(null);
    this.clearDraft();
  }

  private clearDraft() {
    const drafts = this.cache.read<Record<string, DraftEnvelope>>(WORKFLOW_DRAFTS_KEY) ?? {};
    delete drafts[this.draftKey];
    this.cache.write(WORKFLOW_DRAFTS_KEY, drafts);
  }

  protected save() {
    if (this.hasErrors()) return;
    try {
      this.accessPolicy.record({
        action: 'definition-write-requested',
        workflowId: this.isNew() ? undefined : this.id,
        occurredAt: new Date().toISOString(),
      });
    } catch {
      this.error.set('This internal change could not be audited, so it was not submitted.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    const write = {
      name: this.name().trim() || 'Untitled workflow',
      ruleJson: this.rule(),
      expectedVersion: this.version,
    };

    if (this.isNew()) {
      this.service.create(write).subscribe({
        next: (record) => {
          this.saving.set(false);
          this.dirty = false;
          this.clearDraft();
          void this.router.navigate(['/workflows', record.id, 'edit']);
        },
        error: (error: Error) => {
          this.saving.set(false);
          this.error.set(error.message);
        },
      });
      return;
    }

    this.service.update(this.id, write).subscribe({
      next: (outcome: SaveOutcome) => {
        this.saving.set(false);
        this.dirty = false;
        this.clearDraft();
        this.version = outcome.record.version;
        this.enabled.set(outcome.record.enabled);
        if (outcome.kind === 'proposed') {
          // The write did NOT land — it became a proposal (four-eyes). Reflect
          // the server truth: baseline unchanged, banner up.
          this.pendingProposal.set(outcome.proposalId);
        } else {
          this.baselineRule.set(outcome.record.ruleJson);
          this.baselineEnabled.set(outcome.record.enabled);
          this.pendingProposal.set(null);
        }
      },
      error: (error: Error) => {
        this.saving.set(false);
        this.error.set(error.message);
      },
    });
  }

  protected goProposals() {
    void this.router.navigate(['/workflows', 'proposals']);
  }

  protected remove() {
    this.deleteOpen.set(true);
  }

  protected confirmRemove() {
    this.deleteOpen.set(false);
    this.deleting.set(true);
    this.error.set(null);
    this.service.remove(this.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.back();
      },
      error: (error: Error) => {
        this.deleting.set(false);
        this.error.set(error.message);
      },
    });
  }

  protected cancelRemove() {
    this.deleteOpen.set(false);
  }

  protected back() {
    void this.router.navigate(['/workflows']);
  }
}
