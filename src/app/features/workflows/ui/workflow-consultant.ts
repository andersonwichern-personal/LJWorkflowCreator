import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ConsultantTurn } from '../../../brain/consultant';
import { Recommendation } from '../../../brain/recommendations';

/**
 * The Workflow Consultant's advisory brief — a structured report, not a chat.
 *
 * Renders one deterministic ConsultantTurn in plain operational language:
 * what was understood, what is recommended (with the exact previewed change
 * text from proposedChanges — never re-derived prose), the at-most-two open
 * questions, the potential gaps, and the single next best action. No raw
 * JSON, no engine jargon, no model confidence numbers — prohibited behaviors
 * are pinned in docs/workflow-consultant-behavior.md.
 *
 * Consent stays with the host: Accept/Reject/answer/dismiss are outputs; the
 * composer routes accepted patches through its ONE rule-mutation path.
 */
@Component({
  selector: 'lj-workflow-consultant',
  template: `
    @if (turn(); as brief) {
      <section class="consultant" aria-labelledby="consultant-title">
        <header class="consultant-head">
          <p class="eyebrow">Workflow consultant</p>
          <h3 id="consultant-title">Advisory brief</h3>
        </header>

        <div class="brief-block">
          <h4>What I understand</h4>
          <p class="understanding">{{ brief.understanding }}</p>
        </div>

        @if (brief.recommendations.length) {
          <div class="brief-block">
            <h4>What I recommend</h4>
            <div class="rec-cards">
              @for (rec of brief.recommendations; track rec.id) {
                <article class="rec-card">
                  <header class="rec-head">
                    <h5>{{ rec.title }}</h5>
                    <span class="risk" [attr.data-risk]="rec.riskLevel">{{ riskLabel(rec.riskLevel) }}</span>
                  </header>
                  <p class="rationale">{{ rec.rationale }}</p>
                  @if (previewFor(brief, rec.id); as preview) {
                    <p class="proposed"><span class="proposed-label">Proposed change</span>{{ preview }}</p>
                  }
                  <div class="rec-actions">
                    <button
                      type="button"
                      class="accept"
                      [disabled]="busy()"
                      (click)="acceptRecommendation.emit(rec)"
                    >Accept</button>
                    <button
                      type="button"
                      class="reject"
                      [disabled]="busy()"
                      (click)="rejectRecommendation.emit(rec)"
                    >Reject</button>
                  </div>
                </article>
              }
            </div>
          </div>
        }

        @if (brief.questions.length) {
          <div class="brief-block">
            <h4>Questions to resolve</h4>
            @for (question of brief.questions; track question.id) {
              <article class="question">
                <p>{{ question.question }}</p>
                <div class="option-row">
                  @for (option of question.options; track option) {
                    <button
                      type="button"
                      [disabled]="busy()"
                      (click)="answerQuestion.emit({ id: question.id, option })"
                    >{{ option }}</button>
                  }
                  @if (!question.options.length) {
                    <button
                      type="button"
                      class="quiet"
                      [disabled]="busy()"
                      (click)="dismissQuestion.emit(question.id)"
                    >Intentionally leave it out</button>
                  }
                </div>
              </article>
            }
          </div>
        }

        @if (brief.watchouts.length) {
          <div class="brief-block">
            <h4>Potential gaps</h4>
            <ul class="watchouts">
              @for (watchout of brief.watchouts; track watchout) {
                <li>{{ watchout }}</li>
              }
            </ul>
          </div>
        }

        <p class="next-action" aria-live="polite">
          <strong>Next best action</strong> {{ brief.nextBestAction }}
        </p>
      </section>
    }
  `,
  styles: `
    :host { display: block; }
    .consultant {
      margin-top: var(--space-6); padding: var(--space-5);
      border: 1px solid var(--border); border-radius: var(--radius-lg);
      background: var(--surface); box-shadow: var(--shadow-soft);
    }
    .consultant-head .eyebrow {
      margin: 0; color: var(--text-soft); font-size: var(--text-xs);
      font-weight: 800; letter-spacing: .09em; text-transform: uppercase;
    }
    .consultant-head h3 { margin: var(--space-1) 0 0; font-size: var(--text-lg); letter-spacing: -.02em; }
    .brief-block { margin-top: var(--space-5); }
    .brief-block h4 {
      margin: 0 0 var(--space-2); color: var(--text-dim);
      font-size: var(--text-xs); font-weight: 800; letter-spacing: .07em; text-transform: uppercase;
    }
    .understanding { margin: 0; color: var(--text); line-height: 1.55; }
    .rec-cards { display: flex; flex-direction: column; gap: var(--space-3); }
    .rec-card {
      padding: var(--space-4); border: 1px solid var(--border);
      border-radius: var(--radius-md); background: var(--surface-inset);
    }
    .rec-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
    .rec-head h5 { margin: 0; font-size: var(--text-sm); font-weight: 780; }
    .risk {
      flex: none; padding: .15rem .55rem; border-radius: var(--radius-pill);
      font-size: .62rem; font-weight: 850; letter-spacing: .06em; text-transform: uppercase;
      border: 1px solid var(--border-strong); color: var(--text-dim);
    }
    .risk[data-risk='medium'] { color: var(--warn-text); border-color: var(--warn-text); }
    .risk[data-risk='high'] { color: var(--danger); border-color: var(--danger); }
    .rationale { margin: var(--space-2) 0 0; color: var(--text-dim); font-size: var(--text-sm); line-height: 1.5; }
    .proposed {
      margin: var(--space-3) 0 0; padding: var(--space-2) var(--space-3);
      border-left: 3px solid var(--brand); background: var(--surface);
      color: var(--text); font-size: var(--text-sm);
    }
    .proposed-label {
      display: block; margin-bottom: 2px; color: var(--text-soft);
      font-size: .62rem; font-weight: 850; letter-spacing: .06em; text-transform: uppercase;
    }
    .rec-actions { display: flex; gap: var(--space-2); margin-top: var(--space-3); }
    button {
      min-height: 36px; padding: .35rem .9rem; border-radius: var(--radius-pill);
      font-size: var(--text-sm); font-weight: 750; cursor: pointer;
    }
    button:disabled { opacity: .5; cursor: not-allowed; }
    button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
    .accept { border: 1px solid var(--brand); background: var(--brand); color: var(--sweet-ink); }
    .reject, .quiet { border: 1px solid var(--border-strong); background: transparent; color: var(--text); }
    .question > p { margin: 0 0 var(--space-2); font-weight: 720; }
    .question + .question { margin-top: var(--space-4); }
    .option-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .option-row button { border: 1px solid var(--brand); background: var(--brand); color: var(--sweet-ink); }
    .option-row button.quiet { border-color: var(--border-strong); background: transparent; color: var(--text); }
    .watchouts { margin: 0; padding-left: 1.1rem; color: var(--warn-text); font-size: var(--text-sm); }
    .watchouts li { margin: .3rem 0; line-height: 1.5; }
    .next-action {
      margin: var(--space-5) 0 0; padding-top: var(--space-4);
      border-top: 1px solid var(--border); color: var(--text); font-size: var(--text-sm);
    }
    .next-action strong { display: block; margin-bottom: 2px; color: var(--text-soft); font-size: var(--text-xs); font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
    /* Calm surface: no animations are declared, and the reduced-motion
       preference pins even inherited transitions to none. */
    @media (prefers-reduced-motion: reduce) {
      .consultant, .consultant * { animation: none !important; transition: none !important; }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkflowConsultant {
  readonly turn = input<ConsultantTurn | null>(null);
  readonly busy = input(false);

  readonly acceptRecommendation = output<Recommendation>();
  readonly rejectRecommendation = output<Recommendation>();
  readonly answerQuestion = output<{ id: string; option: string }>();
  readonly dismissQuestion = output<string>();

  /** Exact previewed change text for a recommendation — from the ops, never prose. */
  protected previewFor(turn: ConsultantTurn, recommendationId: string): string | null {
    return (
      turn.proposedChanges.find((change) => change.recommendationId === recommendationId)
        ?.preview ?? null
    );
  }

  protected riskLabel(risk: Recommendation['riskLevel']): string {
    if (risk === 'high') return 'High risk';
    if (risk === 'medium') return 'Medium risk';
    return 'Low risk';
  }
}
