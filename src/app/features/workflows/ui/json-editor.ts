import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { WorkflowRule } from '../../../core/vocabulary';
import { validateRule } from '../../../core/ruleValidation';

/**
 * Raw definition editor over the same model — the admin console gates this
 * behind the EDIT_JSON feature flag and uses Monaco; a plain textarea keeps
 * this workspace dependency-free. Apply runs the shared validator: parse
 * errors and validation errors both block.
 */
@Component({
  selector: 'wf-json-editor',
  template: `
    <div class="editor">
      <textarea
        class="area"
        spellcheck="false"
        [value]="text()"
        (input)="onInput($any($event.target).value)"
      ></textarea>
      <div class="bar">
        @if (error(); as message) {
          <span class="error">{{ message }}</span>
        }
        <button type="button" class="apply" [disabled]="!!error()" (click)="apply()">Apply JSON</button>
      </div>
    </div>
  `,
  styles: `
    .editor { display: flex; flex-direction: column; gap: 8px; }
    .area {
      width: 100%; box-sizing: border-box; min-height: 320px; resize: vertical;
      font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; line-height: 1.5;
      color: var(--text); background: var(--surface-inset);
      border: 1px solid var(--border); border-radius: 10px; padding: 12px; outline: none;
    }
    .area:focus { border-color: var(--brand); }
    .bar { display: flex; align-items: center; gap: 12px; justify-content: flex-end; }
    .error { font-size: 12px; color: var(--danger); margin-right: auto; }
    .apply {
      font: inherit; font-size: 13px; font-weight: 700; padding: 8px 16px;
      background: var(--brand); color: #063a2e; border: 0; border-radius: 8px; cursor: pointer;
    }
    .apply:disabled { opacity: 0.45; cursor: not-allowed; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JsonEditor {
  @Input() set rule(value: WorkflowRule) {
    this.text.set(JSON.stringify(value, null, 2));
    this.error.set(null);
  }
  @Output() applied = new EventEmitter<WorkflowRule>();

  protected readonly text = signal('{}');
  protected readonly error = signal<string | null>(null);

  protected onInput(value: string) {
    this.text.set(value);
    this.error.set(this.check(value));
  }

  private check(value: string): string | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid JSON';
    }
    const { issues } = validateRule(parsed);
    const firstError = issues.find((issue) => issue.severity === 'error');
    return firstError ? `${firstError.code}: ${firstError.message}` : null;
  }

  protected apply() {
    const { rule } = validateRule(JSON.parse(this.text()));
    if (rule) this.applied.emit(rule);
  }
}
