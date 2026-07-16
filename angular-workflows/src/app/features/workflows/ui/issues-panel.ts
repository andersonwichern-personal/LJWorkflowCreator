import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { RuleIssue } from '../../../core/ruleValidation';

/** Validation output from the shared core `validateRule` — errors block save. */
@Component({
  selector: 'wf-issues-panel',
  template: `
    @if (issues.length) {
      <ul class="issues">
        @for (issue of issues; track $index) {
          <li [class.error]="issue.severity === 'error'" [class.warning]="issue.severity === 'warning'">
            <span class="sev">{{ issue.severity }}</span>
            <span>{{ issue.message }}</span>
            <span class="code">{{ issue.code }}</span>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .issues { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
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
  @Input() issues: RuleIssue[] = [];
}
