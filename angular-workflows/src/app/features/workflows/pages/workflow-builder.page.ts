import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { interval } from 'rxjs';
import {
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
import { RuleIssue, validateRule } from '../../../core/ruleValidation';
import { CacheService, DRAFT_AUTOSAVE_MS, NEW_WORKFLOW_ID, WORKFLOW_DRAFTS_KEY } from '../../../shared/cache.service';
import { LJ_PRIMITIVES } from '../../../shared/lj/lj';
import { WorkflowsService } from '../data/workflows.service';
import { ChatDraft } from '../ui/chat-draft';
import { ControlsPanel } from '../ui/controls-panel';
import { IssuesPanel } from '../ui/issues-panel';
import { JsonEditor } from '../ui/json-editor';
import { RuleSentence } from '../ui/rule-sentence';

interface DraftEnvelope {
  rule: WorkflowRule;
  name: string;
  savedAt: string;
}

/**
 * The builder page: Dynamic-Form-builder chrome (Back / History placeholder /
 * Design–JSON toggle / Save), chat drafting, the WHEN/IF/THEN sentence,
 * safety controls, and the shared validator gating save. Drafts auto-save to
 * localStorage every 2s (admin draft contract) keyed by id or NEW_WORKFLOW_ID.
 */
@Component({
  selector: 'wf-workflow-builder-page',
  imports: [...LJ_PRIMITIVES, RuleSentence, ControlsPanel, IssuesPanel, ChatDraft, JsonEditor],
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
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </lj-box-row>
        </lj-box>
      </header>

      @if (draftBanner(); as draft) {
        <div class="restore">
          <span>Unsaved draft from {{ draft.savedAt.slice(11, 16) }} found.</span>
          <button type="button" (click)="restoreDraft()">Restore</button>
          <button type="button" (click)="discardDraft()">Discard</button>
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
    .restore {
      display: flex; align-items: center; gap: 10px; font-size: 13px;
      background: var(--warn-bg); color: var(--warn-text);
      border-radius: 10px; padding: 10px 14px; margin: 16px 0 0;
    }
    .restore button {
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

  private version: number | undefined;
  private dirty = false;

  protected readonly issues = computed<RuleIssue[]>(() => validateRule(this.rule()).issues);
  protected readonly hasErrors = computed(() =>
    this.issues().some((issue) => issue.severity === 'error')
  );

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
    // Admin draft contract: steady 2s autosave of dirty state.
    interval(DRAFT_AUTOSAVE_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.persistDraft());
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
  }
  protected setControls(controls: WorkflowRule['controls']) {
    this.setRule({ ...this.rule(), controls });
  }
  protected applyDraftedRule(rule: WorkflowRule) {
    this.setRule(rule);
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
    const request = this.isNew() ? this.service.create(write) : this.service.update(this.id, write);
    request.subscribe({
      next: (record) => {
        this.saving.set(false);
        this.dirty = false;
        this.clearDraft();
        this.version = record.version;
        if (this.isNew()) void this.router.navigate(['/workflows', record.id, 'edit']);
      },
      error: (error: Error) => {
        this.saving.set(false);
        this.error.set(error.message);
      },
    });
  }

  protected remove() {
    if (!confirm(`Delete "${this.name()}"? This cannot be undone.`)) return;
    this.service.remove(this.id).subscribe({ next: () => this.back() });
  }

  protected back() {
    void this.router.navigate(['/workflows']);
  }
}
