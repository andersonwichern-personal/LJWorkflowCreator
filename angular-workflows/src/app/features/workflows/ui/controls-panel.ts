import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { RuleControls } from '../../../core/vocabulary';

/**
 * The safety rails that live INSIDE the rule (shared core `RuleControls`):
 * shadow/armed, once-per-request idempotency, hourly rate cap, missing-data
 * posture, priority. Defaults are shadow-first — a new rule observes before it
 * acts, and arming is an explicit, labeled decision.
 */
@Component({
  selector: 'wf-controls-panel',
  template: `
    <div class="grid">
      <label class="control mode">
        <span class="name">Mode</span>
        <span class="seg">
          <button type="button" [class.active]="controls.mode === 'shadow'" (click)="patch({ mode: 'shadow' })">
            Shadow
          </button>
          <button type="button" [class.active]="controls.mode === 'armed'" (click)="patch({ mode: 'armed' })">
            Armed
          </button>
        </span>
        <span class="hint">
          {{ controls.mode === 'shadow'
            ? 'Observes and logs what it would do — no real actions.'
            : 'Live: actions really execute. Arm only after shadow-verifying.' }}
        </span>
      </label>

      <label class="control">
        <span class="name">Once per request</span>
        <input type="checkbox" [checked]="controls.oncePerRequest" (change)="patch({ oncePerRequest: $any($event.target).checked })" />
        <span class="hint">Never fire twice for the same request.</span>
      </label>

      <label class="control">
        <span class="name">Max fires / hour</span>
        <input
          class="num" type="number" min="1" [value]="controls.maxFiresPerHour"
          (change)="patchCap($any($event.target).value)"
        />
        <span class="hint">Circuit breaker — auto-pauses past this rate.</span>
      </label>

      <label class="control">
        <span class="name">Missing data</span>
        <select [value]="controls.missingData" (change)="patch({ missingData: $any($event.target).value })">
          <option value="no_match">treat as no match</option>
          <option value="alert">no match + alert</option>
        </select>
        <span class="hint">Absent fields always fail closed; alert makes it loud.</span>
      </label>

      <label class="control">
        <span class="name">Priority</span>
        <input class="num" type="number" [value]="controls.priority" (change)="patchPriority($any($event.target).value)" />
        <span class="hint">Lower runs first when several rules match.</span>
      </label>
    </div>
  `,
  styles: `
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
    .control { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
    .name { font-weight: 700; font-size: 12px; color: var(--text-dim); letter-spacing: 0.03em; }
    .hint { font-size: 11px; color: var(--text-dim); }
    .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; width: fit-content; }
    .seg button {
      font: inherit; font-size: 12px; font-weight: 600; padding: 6px 14px;
      background: var(--surface); color: var(--text-dim); border: 0; cursor: pointer;
    }
    .seg button.active { background: var(--brand); color: #063a2e; }
    .num, select {
      font: inherit; font-size: 13px; padding: 6px 10px; width: fit-content;
      border: 1px solid var(--border); border-radius: 8px;
      background: var(--surface-inset); color: var(--text);
    }
    input[type='checkbox'] { width: 16px; height: 16px; accent-color: var(--brand); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ControlsPanel {
  @Input({ required: true }) controls!: RuleControls;
  @Output() controlsChange = new EventEmitter<RuleControls>();

  protected patch(patch: Partial<RuleControls>) {
    this.controlsChange.emit({ ...this.controls, ...patch });
  }
  protected patchCap(raw: string) {
    const value = Math.max(1, Math.floor(Number(raw) || 1));
    this.patch({ maxFiresPerHour: value });
  }
  protected patchPriority(raw: string) {
    const value = Math.floor(Number(raw));
    this.patch({ priority: Number.isFinite(value) ? value : 100 });
  }
}
