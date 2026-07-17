import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ParseResult, parseInstruction } from '../../../core/nlParser';
import { parseGateReport } from '../../../core/parseGate';
import { interpretRule } from '../../../core/interpretation';
import { LJ_PRIMITIVES } from '../../../shared/lj/lj';
import { WorkflowsService } from '../data/workflows.service';

/**
 * AI-first composer (composer roadmap MVP 2) — the client's default create
 * experience. Describe intent → build → review a plain-language
 * interpretation + checklist. The canonical When/If/Then rule is built and
 * validated behind the scenes; the client never sees tokens, operators,
 * condition groups, or JSON.
 *
 * Interpretation and checklist come from the deterministic rule-core
 * `interpretRule` — generated FROM the rule, never from the description, so
 * what the client reviews is what the runtime executes. Save stays disabled
 * while the semantic-coverage gate (MVP 1) reports gaps.
 *
 * Conversational revisions and the clarification loop are MVP 3; today the
 * refine path is editing the description and rebuilding.
 */
@Component({
  selector: 'wf-workflow-composer-page',
  imports: [...LJ_PRIMITIVES],
  template: `
    <lj-page>
      <header header>
        <lj-box class="header" [padding]="4">
          <lj-box-row [paddingBlockEnd]="4">
            <button lj-button (click)="back()">← Back</button>
            <h1 class="title">New workflow</h1>
            <span class="spacer"></span>
          </lj-box-row>
        </lj-box>
      </header>

      @if (!reviewing()) {
        <section class="card">
          <h2 class="card-title">Describe the workflow</h2>
          <p class="lead">
            Say what should happen and when, in your own words. You'll review exactly how it was
            understood before anything runs.
          </p>
          <textarea
            class="describe"
            rows="4"
            [value]="text()"
            (input)="text.set($any($event.target).value)"
            placeholder="Example: When an approved loan is at least $250,000, assign it to the Underwriting Team and notify Wael. Otherwise, do nothing."
          ></textarea>
          <div class="examples">
            <span class="examples-label">Try one:</span>
            @for (example of EXAMPLES; track example) {
              <button type="button" class="example" (click)="text.set(example)">{{ example }}</button>
            }
          </div>
          <div class="actions-row">
            <button lj-button class="primary" [disabled]="!text().trim()" (click)="build()">
              Build workflow
            </button>
          </div>
          @if (parseFailure(); as messages) {
            <div class="parse-failure">
              <p><b>I couldn't turn that into a workflow yet.</b></p>
              @for (message of messages; track $index) {
                <p>{{ message }}</p>
              }
            </div>
          }
        </section>
      } @else {
        <section class="card">
          <h2 class="card-title">Here's what will happen</h2>
          <p class="interpretation">{{ interpretation()?.summary }}</p>
          <ul class="checklist">
            @for (item of interpretation()?.checklist; track $index) {
              <li>{{ item }}</li>
            }
          </ul>
        </section>

        @if (gaps().length) {
          <div class="needs">
            <p class="needs-head">
              <b>Draft interpretation</b> — needs {{ gaps().length }}
              answer{{ gaps().length === 1 ? '' : 's' }} before it can run.
            </p>
            <ul>
              @for (gap of gaps(); track $index) {
                <li>{{ gap }}</li>
              }
            </ul>
            <p class="needs-hint">Refine the description to answer these, then build again.</p>
          </div>
        }

        @if (error(); as message) {
          <div class="error-bar">{{ message }}</div>
        }

        <div class="actions-row">
          <button lj-button (click)="refine()">← Refine description</button>
          <span class="spacer"></span>
          <button
            lj-button
            class="primary"
            [disabled]="gaps().length > 0 || saving()"
            (click)="save()"
          >
            {{ saving() ? 'Saving…' : 'Save workflow' }}
          </button>
        </div>
      }
    </lj-page>
  `,
  styles: `
    .title { margin: 0; font-size: 18px; font-weight: 700; }
    .spacer { flex: 1; }
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 14px; padding: 18px 20px; margin-top: 18px;
    }
    .card-title {
      margin: 0 0 14px; font-size: 11px; font-weight: 800;
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim);
    }
    .lead { margin: 0 0 12px; font-size: 13px; color: var(--text-dim); }
    .describe {
      width: 100%; box-sizing: border-box; font: inherit; font-size: 14px;
      color: var(--text); background: var(--surface-inset);
      border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;
      resize: vertical; outline: none;
    }
    .describe:focus { border-color: var(--brand, var(--text-dim)); }
    .examples { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
    .examples-label { font-size: 12px; color: var(--text-dim); }
    .example {
      font: inherit; font-size: 12px; text-align: left; cursor: pointer;
      background: var(--surface-inset); color: var(--text-dim);
      border: 1px solid var(--border); border-radius: 999px; padding: 5px 12px;
    }
    .example:hover { color: var(--text); }
    .actions-row { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
    .interpretation { margin: 0 0 14px; font-size: 16px; line-height: 1.5; color: var(--text); }
    .checklist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .checklist li { font-size: 13px; color: var(--text); padding-left: 22px; position: relative; }
    .checklist li::before { content: '✓'; position: absolute; left: 2px; color: var(--brand, currentColor); font-weight: 700; }
    .needs {
      font-size: 13px; background: var(--warn-bg); color: var(--warn-text);
      border-radius: 10px; padding: 12px 16px; margin-top: 16px;
    }
    .needs-head { margin: 0 0 6px; }
    .needs ul { margin: 0; padding-left: 18px; }
    .needs-hint { margin: 8px 0 0; font-style: italic; }
    .parse-failure {
      font-size: 13px; background: var(--warn-bg); color: var(--warn-text);
      border-radius: 10px; padding: 12px 16px; margin-top: 14px;
    }
    .parse-failure p { margin: 4px 0; }
    .error-bar {
      font-size: 13px; color: var(--danger); margin-top: 16px;
      background: color-mix(in srgb, var(--danger) 9%, transparent);
      border-radius: 10px; padding: 10px 14px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkflowComposerPage {
  private readonly router = inject(Router);
  private readonly service = inject(WorkflowsService);

  protected readonly EXAMPLES = [
    'When an approved loan is at least $250,000, assign it to the Underwriting Team and notify Wael. Otherwise, do nothing.',
    'When a loan is approved, notify Wael. Otherwise notify Sara.',
    'When a loan is rejected, add tag needs-review and notify Sara.',
  ];

  protected readonly text = signal('');
  protected readonly result = signal<ParseResult | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Review mode: a parse produced a rule to interpret. */
  protected readonly reviewing = computed(() => this.result()?.rule != null);

  /** Parse produced nothing usable — keep the client in describe mode. */
  protected readonly parseFailure = computed<string[] | null>(() => {
    const result = this.result();
    if (!result || result.rule) return null;
    const ambiguous = result.ambiguities.map((a) => a.question);
    return ambiguous.length ? ambiguous : result.notes;
  });

  protected readonly interpretation = computed(() => {
    const rule = this.result()?.rule;
    return rule ? interpretRule(rule) : null;
  });

  /** MVP 1 gate: gap messages in plain language; save disabled while any remain. */
  protected readonly gaps = computed<string[]>(() => {
    const result = this.result();
    if (!result) return [];
    return parseGateReport(result).issues.map((issue) => issue.message);
  });

  protected build() {
    this.error.set(null);
    this.result.set(parseInstruction(this.text().trim()));
  }

  protected refine() {
    this.result.set(null);
  }

  protected save() {
    const rule = this.result()?.rule;
    if (!rule || this.gaps().length > 0) return;
    this.saving.set(true);
    this.error.set(null);
    const description = this.text().trim();
    const name = description.length > 60 ? `${description.slice(0, 57)}…` : description;
    this.service.create({ name, description, ruleJson: rule }).subscribe({
      next: () => void this.router.navigate(['/workflows']),
      error: (error: Error) => {
        this.saving.set(false);
        this.error.set(error.message);
      },
    });
  }

  protected back() {
    void this.router.navigate(['/workflows']);
  }
}
