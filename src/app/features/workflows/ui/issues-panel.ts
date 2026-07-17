import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { RuleIssue } from '../../../core/ruleValidation';

/**
 * Linter dashboard (Phase B1): renders the combined validation + semantic lint
 * findings from the shared core `lintRule`. Errors are blocking (the builder
 * also disables Save); warnings are advisory. A clean rule shows a quiet
 * all-clear instead of disappearing, so authors learn the panel is watching.
 */
@Component({
  selector: 'wf-issues-panel',
  template: `
    @if (!sorted().length) {
      <p class="all-clear">✓ No lint issues — this rule looks sound.</p>
    } @else {
      <div class="panel">
        <div class="head">
          <span class="title">Linter</span>
          @if (errorCount(); as errors) {
            <span class="chip error">{{ errors }} blocking</span>
          }
          @if (warningCount(); as warnings) {
            <span class="chip warning">{{ warnings }} warning{{ warnings === 1 ? '' : 's' }}</span>
          }
        </div>
        <ul class="issues">
          @for (issue of sorted(); track $index) {
            <li [class.error]="issue.severity === 'error'" [class.warning]="issue.severity === 'warning'">
              <span class="sev">{{ issue.severity }}</span>
              <span>{{ issue.message }}</span>
              <span class="code">{{ issue.code }}</span>
            </li>
          }
        </ul>
      </div>
    }
  `,
  styles: `
    .all-clear {
      margin: 0; font-size: 12px; border-radius: 8px; padding: 8px 12px;
      background: var(--surface-inset); color: var(--text-dim);
    }
    .panel { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
    .head {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; border-bottom: 1px solid var(--border);
    }
    .title {
      font-size: 10px; font-weight: 800; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--text-dim);
    }
    .chip {
      font-size: 10px; font-weight: 800; border-radius: 999px; padding: 2px 10px;
    }
    .chip.error { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }
    .chip.warning { background: var(--warn-bg); color: var(--warn-text); }
    .issues {
      list-style: none; margin: 0; padding: 8px 8px;
      display: flex; flex-direction: column; gap: 6px;
    }
    li {
      display: flex; align-items: baseline; gap: 8px; font-size: 13px;
      border-radius: 8px; padding: 8px 12px;
    }
    li.error { background: color-mix(in srgb, var(--danger) 9%, transparent); color: var(--danger); }
    li.warning { background: var(--warn-bg); color: var(--warn-text); }
    .sev { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; }
    .code { margin-left: auto; font-size: 10px; opacity: 0.6; font-family: ui-monospace, monospace; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssuesPanel {
  private readonly issuesSignal = signal<RuleIssue[]>([]);

  @Input() set issues(value: RuleIssue[]) {
    this.issuesSignal.set(value);
  }

  /** Errors first — blocking findings should never hide below advisory ones. */
  protected readonly sorted = computed(() => {
    const issues = this.issuesSignal();
    return [
      ...issues.filter((issue) => issue.severity === 'error'),
      ...issues.filter((issue) => issue.severity !== 'error'),
    ];
  });
  protected readonly errorCount = computed(
    () => this.sorted().filter((issue) => issue.severity === 'error').length
  );
  protected readonly warningCount = computed(
    () => this.sorted().filter((issue) => issue.severity === 'warning').length
  );
}
