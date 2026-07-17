import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  ViewChild,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Clarification, applyClarification, clarificationsFor } from '../../../core/clarifications';
import { interpretRule } from '../../../core/interpretation';
import { ParseResult, parseInstruction } from '../../../core/nlParser';
import { applyOrgPolicy, protectionsFor } from '../../../core/orgPolicy';
import { parseGateReport } from '../../../core/parseGate';
import { applyRevision } from '../../../core/revisions';
import {
  ExplainedSimulation,
  SimOutcome,
  explainSimulation,
} from '../../../core/simulationExplainer';
import { validateRule } from '../../../core/ruleValidation';
import { LJ_PRIMITIVES } from '../../../shared/lj/lj';
import { WorkflowsService } from '../data/workflows.service';
import { SweetSpiral } from '../ui/sweet-spiral';
import {
  SWEET_SPIRAL_STATUS,
  deriveSweetSpiralState,
} from '../ui/sweet-spiral.state';

type ComposerPhase = 'idle' | 'submitted' | 'parsing' | 'parser-error' | 'network-error';

@Component({
  selector: 'wf-workflow-composer-page',
  imports: [...LJ_PRIMITIVES, SweetSpiral],
  template: `
    <lj-page>
      <div class="composer-shell" [class.has-draft]="reviewing()">
        <button type="button" class="back" (click)="back()">
          <span aria-hidden="true">←</span> Workflows
        </button>

        <section class="hero" aria-labelledby="composer-title">
          <div class="spiral-wrap">
            <wf-sweet-spiral [state]="spiralState()" [typingPulse]="typingPulse()" />
          </div>

          <div class="invitation">
            @if (!reviewing()) {
              <p class="eyebrow">A clearer way to work</p>
              <h1 id="composer-title">
                Let’s make your operations a little sweeter.
                <span>Create a workflow.</span>
              </h1>
            } @else {
              <p class="eyebrow">{{ gaps().length ? 'Let’s clarify the details' : 'Ready to review' }}</p>
              <h1 id="composer-title">
                {{ gaps().length ? 'A little more context will make this precise.' : 'Here’s how I understand it.' }}
              </h1>
            }

            <form class="composer" (submit)="build($event)">
              <label class="sr-only" for="workflow-description">Describe the workflow</label>
              <textarea
                #composerInput
                id="workflow-description"
                rows="1"
                autocomplete="off"
                spellcheck="true"
                [value]="text()"
                [attr.aria-describedby]="focused() ? 'composer-guidance' : null"
                (focus)="focused.set(true)"
                (blur)="focused.set(false)"
                (input)="onInput($event)"
                (keydown)="onComposerKeydown($event)"
              ></textarea>
              @if (!text()) {
                <span class="caret-prompt" aria-hidden="true">_</span>
              }
              @if (text().trim()) {
                <button type="submit" class="send" aria-label="Create workflow from this description">
                  <span aria-hidden="true">↗</span>
                </button>
              }
            </form>

            @if (focused() || text()) {
              <p class="guidance" id="composer-guidance">
                Enter to continue <span aria-hidden="true">·</span> Shift + Enter for a new line
              </p>
            }
            <p class="sr-only" aria-live="polite" aria-atomic="true">{{ liveStatus() }}</p>
          </div>
        </section>

        @if (parseFailure(); as messages) {
          <section class="notice error" role="alert">
            <p class="notice-kicker">I couldn’t make that precise yet.</p>
            @for (message of messages; track $index) {
              <p>{{ message }}</p>
            }
            <p>Adjust the description above and try again. Nothing has been created.</p>
          </section>
        }

        @if (reviewing()) {
          <nav class="journey" aria-label="Workflow creation progress">
            <ol>
              @for (step of journeySteps(); track step.label) {
                <li [class.current]="step.current" [class.done]="step.done">
                  <span>{{ step.number }}</span>{{ step.label }}
                </li>
              }
            </ol>
          </nav>

          <div class="review-flow">
            <section class="review-section" aria-labelledby="interpretation-title">
              <p class="section-index">01 · Review</p>
              <div>
                <h2 id="interpretation-title">What Sweet understood</h2>
                <p class="interpretation">{{ interpretation()?.summary }}</p>
                <ul class="checklist">
                  @for (item of interpretation()?.checklist; track $index) {
                    <li>{{ item }}</li>
                  }
                </ul>
              </div>
            </section>

            @if (gaps().length) {
              <section class="review-section" aria-labelledby="clarification-title">
                <p class="section-index">02 · Clarify</p>
                <div>
                  <h2 id="clarification-title">
                    {{ gaps().length }} detail{{ gaps().length === 1 ? '' : 's' }} need your answer
                  </h2>
                  <p class="section-intro">
                    Sweet won’t activate a partial interpretation. Choose only what you intend.
                  </p>
                  @for (question of visibleQuestions(); track question.id) {
                    <article class="question">
                      <p>{{ question.question }}</p>
                      <div class="answer-row">
                        @for (option of question.options; track option) {
                          <button type="button" (click)="answer(question, option)">{{ option }}</button>
                        }
                        @if (question.allowDismiss) {
                          <button type="button" class="quiet" (click)="dismiss(question)">
                            Intentionally leave it out
                          </button>
                        }
                      </div>
                      @if (question.kind === 'unresolved' && question.options.length) {
                        <form class="answer-free" (submit)="answerFree($event, question)">
                          <label class="sr-only" [for]="'answer-' + question.id">Confirmed answer</label>
                          <input [id]="'answer-' + question.id" type="text" placeholder="Or type one of the suggested answers" />
                          <button type="submit">Answer</button>
                        </form>
                      }
                    </article>
                  }
                  @if (gaps().length > visibleQuestions().length) {
                    <p class="more">{{ gaps().length - visibleQuestions().length }} more after these.</p>
                  }
                </div>
              </section>
            }

            <section class="review-section" aria-labelledby="revise-title">
              <p class="section-index">{{ gaps().length ? '03' : '02' }} · Refine</p>
              <div>
                <h2 id="revise-title">Change it conversationally</h2>
                <form class="revise" (submit)="revise($event)">
                  <label class="sr-only" for="workflow-revision">Describe a change</label>
                  <input
                    id="workflow-revision"
                    type="text"
                    [value]="revisionText()"
                    (input)="revisionText.set($any($event.target).value)"
                    placeholder="Raise the amount to $500,000."
                  />
                  <button type="submit" [disabled]="!revisionText().trim()">Apply change</button>
                </form>
                @if (revisionNote(); as note) {
                  <p class="feedback success" role="status">Updated. {{ note }}</p>
                }
                @if (revisionError(); as message) {
                  <p class="feedback warning" role="alert">{{ message }}</p>
                }
              </div>
            </section>

            @if (simulation(); as sim) {
              <section class="review-section" aria-labelledby="simulation-title">
                <p class="section-index">{{ gaps().length ? '04' : '03' }} · Test</p>
                <div>
                  <h2 id="simulation-title">Tried against {{ sim.tested }} recent requests</h2>
                  <div class="sim-totals" aria-label="Simulation outcome summary">
                    <button type="button" [class.active]="filter() === 'run'" (click)="filter.set('run')">
                      <strong>{{ sim.wouldRun }}</strong><span>Would run</span>
                    </button>
                    <button type="button" [class.active]="filter() === 'skip'" (click)="filter.set('skip')">
                      <strong>{{ sim.wouldSkip }}</strong><span>Would skip</span>
                    </button>
                    <button type="button" [class.active]="filter() === 'needs_data'" (click)="filter.set('needs_data')">
                      <strong>{{ sim.needsData }}</strong><span>Could not evaluate</span>
                    </button>
                  </div>
                  <button type="button" class="show-all" (click)="filter.set('all')">Show every outcome</button>
                  <div class="results">
                    @for (result of filteredResults(); track result.requestId) {
                      <details class="sim-result">
                        <summary>
                          <span class="outcome" [attr.data-outcome]="result.outcome"></span>
                          <span>{{ result.requestName }}</span>
                          <small>{{
                            result.outcome === 'run'
                              ? 'Would run'
                              : result.outcome === 'skip'
                                ? 'Would skip'
                                : 'Could not evaluate'
                          }}</small>
                        </summary>
                        <p>{{ result.explanation }}</p>
                        @if (result.actions.length) {
                          <ul>
                            @for (action of result.actions; track $index) {
                              <li>{{ action }}</li>
                            }
                          </ul>
                        }
                      </details>
                    }
                  </div>
                </div>
              </section>
            }

            <section class="final-actions" [class.blocked]="gaps().length">
              <div>
                <p class="eyebrow">{{ gaps().length ? 'Waiting for clarity' : 'Safe by default' }}</p>
                <h2>{{ gaps().length ? 'Answer the open questions to continue.' : 'Start by observing what would happen.' }}</h2>
                <details class="protections">
                  <summary>Protections applied</summary>
                  <ul>
                    @for (protection of protections(); track protection.title) {
                      <li><strong>{{ protection.title }}</strong> — {{ protection.description }}</li>
                    }
                  </ul>
                </details>
              </div>
              <button
                type="button"
                class="observe"
                [disabled]="gaps().length > 0 || parsedDescription() !== text().trim() || saving()"
                (click)="save()"
              >
                {{ saving() ? 'Starting…' : 'Start observing' }} <span aria-hidden="true">↗</span>
              </button>
            </section>
          </div>
        }

        @if (error(); as message) {
          <div class="notice error" role="alert">{{ message }}</div>
        }
      </div>
    </lj-page>
  `,
  styles: `
    :host { display: block; }
    .composer-shell { padding-top: var(--space-6); }
    .back {
      min-height: 42px; display: inline-flex; align-items: center; gap: var(--space-2);
      margin-left: max(0px, calc((100% - 1160px) / 2)); border: 0; background: transparent;
      color: var(--text-dim); font-size: var(--text-sm); font-weight: 700; cursor: pointer;
    }
    .back:hover { color: var(--text); }
    .hero {
      min-height: calc(100vh - 150px); width: min(100%, 1160px); margin: 0 auto;
      display: grid; grid-template-columns: minmax(18rem, 1.05fr) minmax(20rem, .95fr);
      align-items: center; gap: clamp(2rem, 7vw, 7rem); padding: var(--space-4) 0 var(--space-12);
    }
    .has-draft .hero { min-height: auto; padding-block: var(--space-6) var(--space-16); }
    .spiral-wrap { width: clamp(20rem, 38vw, 35rem); max-width: 100%; justify-self: center; }
    .has-draft .spiral-wrap { width: clamp(16rem, 29vw, 25rem); }
    h1 { margin: var(--space-4) 0 0; font-size: var(--text-display); line-height: .98; letter-spacing: -.058em; font-weight: 760; }
    h1 span { display: block; color: var(--brand-text); }
    .has-draft h1 { font-size: clamp(2.35rem, 4.4vw, 4.25rem); }
    .composer { position: relative; display: flex; align-items: flex-end; margin-top: var(--space-10); }
    textarea {
      width: 100%; min-height: 3.6rem; max-height: 14rem; padding: .55rem 3.5rem .7rem 0;
      border: 0; outline: 0; resize: none; overflow: hidden; color: var(--text); background: transparent;
      font-size: clamp(1.2rem, 2.2vw, 1.75rem); line-height: 1.42; caret-color: var(--brand);
    }
    .caret-prompt { position: absolute; left: 0; bottom: .72rem; color: var(--brand); font-size: 1.65rem; animation: blink 1.1s steps(2, end) infinite; pointer-events: none; }
    .composer:focus-within .caret-prompt { opacity: 0; animation: none; }
    .send {
      position: absolute; right: 0; bottom: .55rem; width: 2.75rem; height: 2.75rem;
      border: 0; border-radius: 50%; background: var(--brand); color: var(--sweet-ink);
      font-weight: 900; cursor: pointer; transition: transform var(--motion-medium) var(--ease-settle);
    }
    .send:hover { transform: translateY(-2px) rotate(3deg); }
    .guidance { margin: var(--space-3) 0 0; color: var(--text-soft); font-size: var(--text-xs); }
    .notice { width: min(100%, 880px); margin: 0 auto var(--space-10); padding: var(--space-5) 0; border-block: 1px solid currentColor; }
    .notice p { margin: .25rem 0; }
    .notice-kicker { font-weight: 800; }
    .notice.error { color: var(--danger); }
    .journey { width: min(100%, 980px); margin: 0 auto var(--space-16); border-block: 1px solid var(--border); }
    .journey ol { display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--space-3); margin: 0; padding: var(--space-4) 0; list-style: none; }
    .journey li { display: flex; align-items: center; gap: var(--space-2); color: var(--text-soft); font-size: var(--text-xs); font-weight: 750; }
    .journey li span { width: 1.6rem; height: 1.6rem; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 50%; }
    .journey li.done { color: var(--text); }
    .journey li.done span { border-color: var(--brand); background: var(--brand); color: var(--sweet-ink); }
    .journey li.current { color: var(--brand-text); }
    .review-flow { width: min(100%, 980px); margin: 0 auto; }
    .review-section { display: grid; grid-template-columns: 9rem 1fr; gap: var(--space-8); padding: var(--space-12) 0; border-top: 1px solid var(--border); }
    .section-index { margin: .35rem 0 0; color: var(--text-soft); font-size: var(--text-xs); font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    h2 { margin: 0; font-size: clamp(1.65rem, 3vw, 2.65rem); line-height: 1.1; letter-spacing: -.04em; }
    .interpretation { max-width: 44rem; margin: var(--space-5) 0 0; font-size: clamp(1.25rem, 2vw, 1.65rem); line-height: 1.5; }
    .checklist { display: grid; gap: var(--space-3); margin: var(--space-6) 0 0; padding: 0; list-style: none; color: var(--text-dim); }
    .checklist li::before { content: '↳'; margin-right: var(--space-3); color: var(--brand-text); }
    .section-intro { max-width: 38rem; color: var(--text-dim); }
    .question { padding: var(--space-6) 0; border-bottom: 1px solid var(--border); }
    .question > p { margin: 0 0 var(--space-4); font-size: var(--text-lg); font-weight: 720; }
    .answer-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .answer-row button, .answer-free button, .revise button {
      min-height: 42px; padding: .55rem 1rem; border: 1px solid var(--brand);
      border-radius: var(--radius-pill); color: var(--sweet-ink); background: var(--brand);
      font-weight: 750; cursor: pointer;
    }
    .answer-row button.quiet { border-color: var(--border-strong); background: transparent; }
    .answer-free, .revise { display: flex; gap: var(--space-3); margin-top: var(--space-4); }
    .answer-free input, .revise input {
      flex: 1; min-width: 0; padding: .75rem 0; border: 0; border-bottom: 1px solid var(--border-strong);
      outline: 0; color: var(--text); background: transparent;
    }
    .answer-free input:focus, .revise input:focus { border-color: var(--brand); }
    .more { color: var(--text-dim); font-size: var(--text-sm); }
    .feedback { margin: var(--space-3) 0 0; font-size: var(--text-sm); }
    .feedback.success { color: var(--success); }
    .feedback.warning { color: var(--warn-text); }
    .sim-totals { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: var(--space-6); border-block: 1px solid var(--border); }
    .sim-totals button { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-5); border: 0; border-right: 1px solid var(--border); background: transparent; text-align: left; cursor: pointer; }
    .sim-totals button:last-child { border-right: 0; }
    .sim-totals button.active { background: var(--surface-inset); }
    .sim-totals strong { font-size: 2rem; line-height: 1; }
    .sim-totals span { color: var(--text-dim); font-size: var(--text-xs); font-weight: 750; text-transform: uppercase; letter-spacing: .06em; }
    .show-all { margin-top: var(--space-3); padding: 0; border: 0; color: var(--brand-text); background: transparent; font-size: var(--text-sm); font-weight: 750; cursor: pointer; }
    .results { margin-top: var(--space-5); }
    .sim-result { border-bottom: 1px solid var(--border); }
    .sim-result summary { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-3); padding: var(--space-4) 0; cursor: pointer; }
    .sim-result summary::marker { content: ''; }
    .outcome { width: .55rem; height: .55rem; border-radius: 50%; background: var(--text-soft); }
    .outcome[data-outcome='run'] { background: var(--success); }
    .outcome[data-outcome='needs_data'] { background: var(--warn); }
    .sim-result small { color: var(--text-dim); }
    .sim-result p, .sim-result ul { margin: 0 0 var(--space-4) 1.3rem; color: var(--text-dim); }
    .final-actions { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: var(--space-8); margin-top: var(--space-10); padding: var(--space-10); border-radius: var(--radius-xl); background: var(--sweet-ink); color: white; }
    .final-actions.blocked { background: var(--surface-inset); color: var(--text); }
    .final-actions .eyebrow { margin: 0 0 var(--space-3); color: #8bb0f7; }
    .final-actions.blocked .eyebrow { color: var(--warn-text); }
    .protections { margin-top: var(--space-5); color: rgb(255 255 255 / .72); font-size: var(--text-sm); }
    .blocked .protections { color: var(--text-dim); }
    .protections summary { cursor: pointer; font-weight: 700; }
    .protections ul { padding-left: 1.1rem; }
    .observe { min-height: 50px; padding: .8rem 1.25rem; border: 0; border-radius: var(--radius-pill); background: var(--brand); color: var(--sweet-ink); font-weight: 820; cursor: pointer; }
    .observe:disabled { opacity: .45; cursor: not-allowed; }
    @keyframes blink { 0%, 45% { opacity: 1; } 46%, 100% { opacity: 0; } }
    @media (max-width: 900px) {
      .hero { grid-template-columns: 1fr; gap: var(--space-3); text-align: center; padding-top: 0; }
      .spiral-wrap, .has-draft .spiral-wrap { width: clamp(15rem, 48vw, 23rem); }
      .invitation { width: min(100%, 42rem); margin: 0 auto; }
      .composer, .guidance { text-align: left; }
      .has-draft .hero { padding-top: 0; }
      .review-section { grid-template-columns: 7rem 1fr; }
    }
    @media (max-width: 620px) {
      .composer-shell { padding-top: var(--space-3); }
      .hero { min-height: calc(100svh - 138px); padding-bottom: var(--space-8); }
      .spiral-wrap, .has-draft .spiral-wrap { width: clamp(13rem, 66vw, 17rem); }
      h1, .has-draft h1 { font-size: clamp(2.45rem, 12vw, 3.5rem); }
      .review-section { grid-template-columns: 1fr; gap: var(--space-3); padding: var(--space-10) 0; }
      .journey { overflow-x: auto; }
      .journey ol { min-width: 34rem; }
      .sim-totals { grid-template-columns: 1fr; }
      .sim-totals button { border-right: 0; border-bottom: 1px solid var(--border); }
      .sim-totals button:last-child { border-bottom: 0; }
      .revise, .answer-free { flex-direction: column; }
      .final-actions { grid-template-columns: 1fr; padding: var(--space-6); }
      .observe { width: 100%; }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkflowComposerPage implements AfterViewInit {
  private readonly router = inject(Router);
  private readonly service = inject(WorkflowsService);
  private readonly injector = inject(Injector);
  private buildGeneration = 0;

  @ViewChild('composerInput') private composerInput?: ElementRef<HTMLTextAreaElement>;

  protected readonly text = signal('');
  protected readonly result = signal<ParseResult | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly focused = signal(false);
  protected readonly typingPulse = signal(0);
  protected readonly phase = signal<ComposerPhase>('idle');
  protected readonly parsedDescription = signal<string | null>(null);

  protected readonly reviewing = computed(() => this.result()?.rule != null);
  protected readonly parseFailure = computed<string[] | null>(() => {
    const result = this.result();
    if (!result || result.rule) return null;
    const ambiguous = result.ambiguities.map((item) => item.question);
    return ambiguous.length ? ambiguous : result.notes;
  });
  protected readonly interpretation = computed(() => {
    const rule = this.result()?.rule;
    return rule ? interpretRule(rule) : null;
  });
  protected readonly gaps = computed<string[]>(() => {
    const result = this.result();
    if (!result) return [];
    const parseIssues = parseGateReport(result).issues.map((issue) => issue.message);
    const validationIssues = result.rule
      ? validateRule(result.rule).issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
      : [];
    return [...new Set([...parseIssues, ...validationIssues])];
  });
  protected readonly visibleQuestions = computed<Clarification[]>(() => {
    const result = this.result();
    return result ? clarificationsFor(result).slice(0, 2) : [];
  });
  protected readonly spiralState = computed(() =>
    deriveSweetSpiralState({
      phase: this.phase(),
      focused: this.focused(),
      hasText: this.text().trim().length > 0,
      hasRule: this.result()?.rule != null,
      hasGaps: this.gaps().length > 0,
      hasQuestions: this.visibleQuestions().length > 0,
    })
  );
  protected readonly liveStatus = computed(() => {
    const base = SWEET_SPIRAL_STATUS[this.spiralState()];
    const count = this.gaps().length;
    return count ? `${base}. ${count} detail${count === 1 ? '' : 's'} need attention.` : base;
  });

  protected readonly revisionText = signal('');
  protected readonly revisionNote = signal<string | null>(null);
  protected readonly revisionError = signal<string | null>(null);
  protected readonly filter = signal<SimOutcome | 'all'>('all');
  protected readonly simulation = computed<ExplainedSimulation | null>(() => {
    const result = this.result();
    if (!result?.rule || this.gaps().length > 0) return null;
    return explainSimulation(result.rule);
  });
  protected readonly filteredResults = computed(() => {
    const simulation = this.simulation();
    if (!simulation) return [];
    const filter = this.filter();
    return filter === 'all'
      ? simulation.results
      : simulation.results.filter((item) => item.outcome === filter);
  });
  protected readonly protections = computed(() => {
    const rule = this.result()?.rule;
    return rule ? protectionsFor(rule) : [];
  });
  protected readonly journeySteps = computed(() => {
    const gaps = this.gaps().length > 0;
    const tested = this.simulation() != null;
    return [
      { number: '1', label: 'Describe', done: true, current: false },
      { number: '2', label: 'Clarify', done: !gaps, current: gaps },
      { number: '3', label: 'Review', done: !gaps, current: !gaps && !tested },
      { number: '4', label: 'Test', done: tested, current: !gaps && tested },
      { number: '5', label: 'Observe', done: false, current: false },
    ];
  });

  ngAfterViewInit() {
    requestAnimationFrame(() => this.composerInput?.nativeElement.focus());
  }

  protected onInput(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    this.buildGeneration++;
    this.text.set(textarea.value);
    this.result.set(null);
    this.parsedDescription.set(null);
    this.error.set(null);
    this.clearRevisionFeedback();
    this.typingPulse.update((pulse) => pulse + 1);
    this.phase.set('idle');
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 224)}px`;
  }

  protected onComposerKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.build();
    }
  }

  protected build(event?: Event) {
    event?.preventDefault();
    const description = this.text().trim();
    if (!description) return;
    const generation = ++this.buildGeneration;
    this.error.set(null);
    this.clearRevisionFeedback();
    this.result.set(null);
    this.parsedDescription.set(null);
    this.phase.set('submitted');

    // Let Angular commit each semantic phase before advancing. This makes the
    // submitted and parsing feedback observable without introducing a fake
    // delay; the parser still runs synchronously once the parsing frame exists.
    afterNextRender(
      () => {
        if (generation !== this.buildGeneration) return;
        this.phase.set('parsing');
        afterNextRender(
          () => this.parseSubmittedDescription(description, generation),
          { injector: this.injector }
        );
      },
      { injector: this.injector }
    );
  }

  private parseSubmittedDescription(description: string, generation: number) {
    if (generation !== this.buildGeneration) return;
    try {
      const result = parseInstruction(description);
      if (generation !== this.buildGeneration) return;
      this.result.set(result);
      this.parsedDescription.set(result.rule ? description : null);
      this.phase.set(result.rule ? 'idle' : 'parser-error');
    } catch {
      this.result.set(null);
      this.parsedDescription.set(null);
      this.phase.set('parser-error');
    }
  }

  protected answer(question: Clarification, value: string) {
    const result = this.result();
    if (!result || !value.trim()) return;
    this.clearRevisionFeedback();
    if (question.needsReparse) {
      const permitted = question.options.find(
        (option) => option.toLowerCase() === value.trim().toLowerCase()
      );
      if (!permitted) {
        this.revisionError.set('Choose one of the confirmed options so Sweet does not guess.');
        return;
      }
      this.result.set(parseInstruction(this.text().trim(), { forceEvent: permitted }));
    } else {
      this.result.set(applyClarification(result, question.id, value));
    }
  }

  protected answerFree(event: Event, question: Clarification) {
    event.preventDefault();
    const input = (event.target as HTMLFormElement).querySelector('input');
    const value = input?.value.trim() ?? '';
    const confirmed = question.options.find(
      (option) => option.toLowerCase() === value.toLowerCase()
    );
    if (!confirmed) {
      this.revisionError.set('Choose a confirmed suggestion so the workflow remains precise.');
      return;
    }
    this.answer(question, confirmed);
    if (input) input.value = '';
  }

  protected dismiss(question: Clarification) {
    const result = this.result();
    if (!result) return;
    this.clearRevisionFeedback();
    this.result.set(applyClarification(result, question.id, { dismiss: true }));
  }

  protected revise(event: Event) {
    event.preventDefault();
    const result = this.result();
    const rule = result?.rule;
    const instruction = this.revisionText().trim();
    if (!result || !rule || !instruction) return;
    this.clearRevisionFeedback();
    const revision = applyRevision(rule, instruction);
    if (revision.status === 'applied') {
      this.result.set({ ...result, rule: revision.rule });
      this.revisionNote.set(revision.summary);
      this.revisionText.set('');
    } else {
      this.revisionError.set(revision.reason);
    }
  }

  private clearRevisionFeedback() {
    this.revisionNote.set(null);
    this.revisionError.set(null);
  }

  protected save() {
    const rule = this.result()?.rule;
    if (!rule || this.gaps().length > 0) return;
    if (this.parsedDescription() !== this.text().trim()) return;
    const validated = validateRule(rule);
    if (!validated.rule || validated.issues.some((issue) => issue.severity === 'error')) {
      this.error.set('This workflow still contains an incomplete detail and cannot start observing.');
      this.phase.set('parser-error');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    const description = this.text().trim();
    const name = description.length > 60 ? `${description.slice(0, 57)}…` : description;
    this.service
      .create({ name, description, ruleJson: applyOrgPolicy(validated.rule) })
      .subscribe({
        next: (record) => void this.router.navigate(['/workflows', record.id]),
        error: (error: Error) => {
          this.saving.set(false);
          this.error.set(error.message);
          this.phase.set('network-error');
        },
      });
  }

  protected back() {
    void this.router.navigate(['/workflows']);
  }
}
