import { ChangeDetectionStrategy, Component, EventEmitter, Output, signal } from '@angular/core';
import { ParseResult, parseInstruction } from '../../../core/nlParser';

/**
 * Plain-English drafting via the shared deterministic parser (core/nlParser).
 * The parser exposes its confidence gaps directly:
 *   - uncovered fragments are LOUD ("the drafted rule does NOT include this"),
 *   - ambiguities render as buttons that re-parse with `forceEvent`,
 *   - unresolved slots are listed with their fuzzy suggestions.
 *
 * Remote model parsing is not wired into this standalone Angular harness, so
 * this component calls the local parser. A backend parser can implement the
 * same contract through the `draft()` seam.
 */
@Component({
  selector: 'wf-chat-draft',
  template: `
    <form class="box" (submit)="submit($event)">
      <input
        class="input"
        type="text"
        [value]="text()"
        (input)="text.set($any($event.target).value)"
        placeholder='Try: "When a loan is approved and loan amount is at least 250000, assign to Underwriting Team and notify Wael"'
      />
      <button type="submit" class="go" [disabled]="!text().trim()">Draft rule</button>
    </form>

    @if (result(); as r) {
      <div class="feedback">
        @for (fragment of r.uncovered; track $index) {
          <div class="banner uncovered">
            ⚠ I didn't understand: “{{ fragment }}” — the drafted rule does <b>not</b> include this.
          </div>
        }
        @for (ambiguity of r.ambiguities; track $index) {
          <div class="banner ask">
            <span>{{ ambiguity.question }}</span>
            <span class="choices">
              @for (option of ambiguity.options; track option) {
                <button type="button" (click)="chooseEvent(option)">{{ option }}</button>
              }
            </span>
          </div>
        }
        @if (r.unresolved.length) {
          <div class="banner unresolved">
            <span>Needs your pick:</span>
            <ul>
              @for (slot of r.unresolved; track $index) {
                <li>
                  heard “{{ slot.heard }}”
                  @if (slot.suggestions.length) {
                    — did you mean {{ slot.suggestions.join(', ') }}?
                  }
                </li>
              }
            </ul>
          </div>
        }
        @for (note of r.notes; track $index) {
          <div class="note">{{ note }}</div>
        }
      </div>
    }
  `,
  styles: `
    .box { display: flex; gap: 8px; }
    .input {
      flex: 1; font: inherit; font-size: 13px; padding: 10px 14px;
      border: 1px solid var(--border); border-radius: 10px;
      background: var(--surface-inset); color: var(--text); outline: none;
    }
    .input:focus { border-color: var(--brand); }
    .go {
      font: inherit; font-size: 13px; font-weight: 700; padding: 0 18px;
      background: var(--brand); color: #063a2e; border: 0; border-radius: 10px; cursor: pointer;
    }
    .go:disabled { opacity: 0.45; cursor: not-allowed; }
    .feedback { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
    .banner { font-size: 13px; border-radius: 10px; padding: 9px 12px; }
    .uncovered { background: var(--warn-bg); color: var(--warn-text); }
    .ask { background: color-mix(in srgb, var(--info) 10%, transparent); color: var(--info); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .choices { display: inline-flex; gap: 6px; }
    .choices button {
      font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
      border: 1px solid currentColor; background: none; color: inherit;
      border-radius: 999px; padding: 3px 12px;
    }
    .unresolved { background: color-mix(in srgb, var(--danger) 8%, transparent); color: var(--danger); }
    .unresolved ul { margin: 4px 0 0; padding-left: 18px; }
    .note { font-size: 12px; color: var(--text-dim); padding-left: 4px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatDraft {
  /**
   * Emits the FULL parse result, not just the rule — the builder needs the
   * sidecar (unresolved/uncovered/ambiguities) so parse gaps keep blocking
   * after the draft lands (composer roadmap MVP 1: an incomplete parse must
   * never present as a successful one).
   */
  @Output() drafted = new EventEmitter<ParseResult>();

  protected readonly text = signal('');
  protected readonly result = signal<ParseResult | null>(null);

  protected submit(event: Event) {
    event.preventDefault();
    this.draft(this.text().trim());
  }

  protected chooseEvent(eventKey: string) {
    this.draft(this.text().trim(), eventKey);
  }

  private draft(instruction: string, forceEvent?: string) {
    if (!instruction) return;
    const result = parseInstruction(instruction, forceEvent ? { forceEvent } : undefined);
    this.result.set(result);
    if (result.rule) this.drafted.emit(result);
  }
}
