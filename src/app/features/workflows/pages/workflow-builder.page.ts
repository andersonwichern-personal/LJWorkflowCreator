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
import { LJ_PRIMITIVES } from '../../../shared/lj/lj';
import { SaveOutcome, WorkflowsService } from '../data/workflows.service';
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
  imports: [...LJ_PRIMITIVES, RuleSentence, ControlsPanel, IssuesPanel, ChatDraft, JsonEditor, SimulationPanel],
  template: `
    <lj-page>
      <header header>
        <lj-box class="header" [padding]="4">
          <lj-box-row [paddingBlockEnd]="4">
            <button lj-button (click)="back()">← Back</button>
            <input
              class="name"
              type="text"
              [value]="name()"
              (input)="rename($any($event.target).value)"
              placeholder="Workflow name"
            />
            <span class="mode-chip" [class.armed]="rule().controls.mode === 'armed'">
              {{ rule().controls.mode }}
            </span>
            <span class="spacer"></span>
            <span class="seg">
              <button type="button" [class.active]="view() === 'design'" (click)="view.set('design')">Design</button>
              <button type="button" [class.active]="view() === 'json'" (click)="view.set('json')">JSON</button>
            </span>
            @if (!isNew()) {
              <button lj-button class="danger" (click)="remove()">Delete</button>
            }
            <button lj-button class="primary" [disabled]="saving() || hasErrors()" (click)="save()">
              {{ saving() ? 'Saving…' : wouldPropose() ? 'Propose changes' : 'Save' }}
            </button>
          </lj-box-row>
        </lj-box>
      </header>

      @if (pendingProposal(); as proposalId) {
        <div class="pending">
          <span>
            A change to this workflow is <b>awaiting a second pair of eyes</b> — it was saved as a
            proposal, not applied.
          </span>
          <button type="button" (click)="goProposals()">Review proposals</button>
        </div>
      }
      @if (draftBanner(); as draft) {
        <div class="restore">
          <span>Unsaved draft from {{ draft.savedAt.slice(11, 16) }} found.</span>
          <button type="button" (click)="restoreDraft()">Restore</button>
          <button type="button" (click)="discardDraft()">Discard</button>
        </div>
      }
      @if (parseGapCount(); as gaps) {
        <div class="restore">
          <span>
            <b>Draft interpretation</b> — needs {{ gaps }} answer{{ gaps === 1 ? '' : 's' }} before
            this workflow can run. The checklist below shows what's missing.
          </span>
        </div>
      }
      @if (error(); as message) {
        <div class="error-bar">{{ message }}</div>
      }

      @if (loading()) {
        <p class="state">Loading…</p>
      } @else {
        <section class="card">
          <h2 class="card-title">Describe it</h2>
          <wf-chat-draft (drafted)="applyDraftedRule($event)" />
        </section>

        @if (view() === 'design') {
          <section class="card">
            <h2 class="card-title">Rule</h2>
            <wf-rule-sentence [rule]="rule()" (ruleChange)="setRule($event)" />
            <p class="summary">{{ summary() }}</p>
          </section>

          <section class="card">
            <h2 class="card-title">Safety controls</h2>
            <wf-controls-panel [controls]="rule().controls" (controlsChange)="setControls($event)" />
          </section>

          <section class="card">
            <h2 class="card-title">Simulate against seed requests</h2>
            <wf-simulation-panel [rule]="rule()" />
          </section>
        } @else {
          <section class="card">
            <h2 class="card-title">Rule JSON (schema v3)</h2>
            <wf-json-editor [rule]="rule()" (applied)="setRule($event)" />
          </section>
        }

        <wf-issues-panel [issues]="issues()" />
      }
    </lj-page>
  `,
  styles: `
    .spacer { flex: 1; }
    .name {
      font: inherit; font-size: 16px; font-weight: 700; min-width: 280px;
      color: var(--text); background: none; outline: none;
      border: 1px solid transparent; border-radius: 8px; padding: 6px 10px;
    }
    .name:hover, .name:focus { border-color: var(--border); background: var(--surface-inset); }
    .mode-chip {
      font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;
      border-radius: 999px; padding: 3px 10px;
      background: var(--surface-inset); color: var(--text-dim);
    }
    .mode-chip.armed { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }
    .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .seg button {
      font: inherit; font-size: 12px; font-weight: 600; padding: 7px 14px;
      background: var(--surface); color: var(--text-dim); border: 0; cursor: pointer;
    }
    .seg button.active { background: var(--surface-inset); color: var(--text); }
    .restore, .pending {
      display: flex; align-items: center; gap: 10px; font-size: 13px;
      background: var(--warn-bg); color: var(--warn-text);
      border-radius: 10px; padding: 10px 14px; margin: 16px 0 0;
    }
    .pending {
      background: color-mix(in srgb, var(--info) 10%, transparent); color: var(--info);
    }
    .restore button, .pending button {
      font: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
      border: 1px solid currentColor; background: none; color: inherit;
      border-radius: 999px; padding: 3px 12px;
    }
    .error-bar {
      font-size: 13px; color: var(--danger); margin-top: 16px;
      background: color-mix(in srgb, var(--danger) 9%, transparent);
      border-radius: 10px; padding: 10px 14px;
    }
    .state { color: var(--text-dim); font-size: 14px; padding: 32px 4px; }
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 14px; padding: 18px 20px; margin-top: 18px;
    }
    .card-title {
      margin: 0 0 14px; font-size: 11px; font-weight: 800;
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim);
    }
    .summary { margin: 14px 0 0; font-size: 12px; color: var(--text-dim); font-style: italic; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkflowBuilderPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(WorkflowsService);
  private readonly cache = inject(CacheService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly id: string = this.route.snapshot.paramMap.get('id') ?? 'new';
  protected readonly isNew = signal(this.id === 'new');

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly view = signal<'design' | 'json'>('design');
  protected readonly name = signal('New workflow');
  protected readonly rule = signal<WorkflowRule>(emptyRule());
  protected readonly draftBanner = signal<DraftEnvelope | null>(null);
  protected readonly pendingProposal = signal<string | null>(null);

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
   * incomplete parse can never read as "No lint issues". Cleared on manual
   * edits — once the user reshapes the rule directly, the description is no
   * longer its source of truth.
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

  protected readonly summary = computed(() => {
    const rule = this.rule();
    const whenPart = rule.triggers.map((t) => getEvent(t.event)?.label ?? t.event).join(' or ');
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
        return `${def?.label ?? output.action}${param}`;
      })
      .join(', ');
    const mode = rule.controls.mode === 'shadow' ? ' [shadow]' : '';
    return `When ${whenPart || '…'}${ifPart ? `, if ${ifPart}` : ''}, then ${thenPart || '…'}.${mode}`;
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
    // Manual edit — the description is no longer this rule's source of truth,
    // so parse-coverage issues (which are statements about the description)
    // no longer apply. Lint still guards the rule itself.
    this.parseMeta.set(null);
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

  private persistDraft() {
    if (!this.dirty) return;
    const drafts = this.cache.read<Record<string, DraftEnvelope>>(WORKFLOW_DRAFTS_KEY) ?? {};
    drafts[this.draftKey] = {
      rule: this.rule(),
      name: this.name(),
      savedAt: new Date().toISOString(),
    };
    this.cache.write(WORKFLOW_DRAFTS_KEY, drafts);
  }

  protected restoreDraft() {
    const draft = this.draftBanner();
    if (!draft) return;
    this.rule.set(draft.rule);
    this.name.set(draft.name);
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
    if (!confirm(`Delete "${this.name()}"? This cannot be undone.`)) return;
    this.service.remove(this.id).subscribe({ next: () => this.back() });
  }

  protected back() {
    void this.router.navigate(['/workflows']);
  }
}
