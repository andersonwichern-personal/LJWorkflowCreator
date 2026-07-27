import { ChangeDetectionStrategy, Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { ConversationMessage, classifyUtterance } from '../../../brain/conversation';
import { ParseResult } from '../../../core/nlParser';
import { ChatService } from '../data/chat.service';
import { DraftEngineService } from '../data/draft-engine.service';

/**
 * Plain-English drafting via {@link DraftEngineService}: real-AI first (the
 * admin console's `parse-ai` endpoint, fronting the Cloudflare AI Gateway),
 * falling back to the deterministic parser in mock mode or on model failure.
 * Either engine returns the same contract, which exposes its confidence gaps
 * directly:
 *   - uncovered fragments are LOUD ("the drafted rule does NOT include this"),
 *   - ambiguities render as buttons that re-parse with `forceEvent`,
 *   - unresolved slots are listed with their fuzzy suggestions.
 *
 * Conversational lane (same as the composer): a failed parse whose text the
 * Brain's classifier reads as social/help chat gets a real assistant reply via
 * {@link ChatService} instead of gap banners. Replies render as plain
 * interpolated text only.
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
      <button type="submit" class="go" [disabled]="!text().trim() || pending()">
        {{ pending() ? 'Drafting…' : 'Draft rule' }}
      </button>
    </form>

    @if (conversation().length) {
      <div class="chat-log" aria-live="polite">
        @for (message of conversation(); track $index) {
          <p class="chat-line" [class.chat-line-user]="message.role === 'user'">
            <b>{{ message.role === 'user' ? 'You' : 'Sweet' }}:</b> {{ message.text }}
          </p>
        }
        @if (chatPending()) {
          <p class="chat-line"><b>Sweet:</b> <i>thinking…</i></p>
        }
      </div>
    }

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
    .chat-log { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
    .chat-line { margin: 0; font-size: 13px; color: var(--text); white-space: pre-wrap; }
    .chat-line-user { color: var(--text-dim); }
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

  private readonly engine = inject(DraftEngineService);
  private readonly chatService = inject(ChatService);

  protected readonly text = signal('');
  protected readonly result = signal<ParseResult | null>(null);
  /** True while the AI engine round-trip is in flight (mock mode resolves synchronously). */
  protected readonly pending = signal(false);
  /** Conversational thread — filled only when a submission was answered as chat. */
  protected readonly conversation = signal<ConversationMessage[]>([]);
  protected readonly chatPending = signal(false);

  protected submit(event: Event) {
    event.preventDefault();
    this.draft(this.text().trim());
  }

  protected chooseEvent(eventKey: string) {
    this.draft(this.text().trim(), eventKey);
  }

  private draft(instruction: string, forceEvent?: string) {
    if (!instruction || this.pending()) return;
    this.pending.set(true);
    this.engine.draft(instruction, forceEvent ? { forceEvent } : undefined).subscribe((result) => {
      this.pending.set(false);
      // Conversational lane: social/help text gets a chat reply, not gap
      // banners. Vocabulary-bearing failures keep the honest gap reporting.
      if (result.rule === null && classifyUtterance(instruction, result) === 'conversational') {
        this.result.set(null);
        this.text.set('');
        this.conversation.update((thread) => [...thread, { role: 'user', text: instruction }]);
        this.chatPending.set(true);
        this.chatService
          .send(this.conversation())
          .then((turn) => {
            this.conversation.update((thread) => [
              ...thread,
              { role: 'assistant', text: turn.reply },
            ]);
          })
          // `send` resolves on every transport failure; this guard covers the
          // truly unexpected (mirrors the composer) so a rejection can neither
          // go unhandled nor leave the thread without an assistant turn.
          .catch(() => {
            this.conversation.update((thread) => [
              ...thread,
              { role: 'assistant', text: 'Something went wrong on my side — ask again?' },
            ]);
          })
          .finally(() => this.chatPending.set(false));
        return;
      }
      this.result.set(result);
      if (result.rule) this.drafted.emit(result);
    });
  }
}
