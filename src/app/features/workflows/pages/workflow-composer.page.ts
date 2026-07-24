import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  ViewChild,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { UserSessionService } from '../../../core/user-session.service';
import { Clarification, applyClarification, clarificationsFor } from '../../../core/clarifications';
import { interpretRule } from '../../../core/interpretation';
import { ParseResult, ParseOptions, parseInstruction } from '../../../core/nlParser';
import { applyOrgPolicy, protectionsFor } from '../../../core/orgPolicy';
import { parseGateReport } from '../../../core/parseGate';
import { applyRevision } from '../../../core/revisions';
import {
  ExplainedSimulation,
  SimOutcome,
  explainSimulation,
} from '../../../core/simulationExplainer';
import { validateRule } from '../../../core/ruleValidation';
import { composeRuleText } from '../../../core/ruleText';
import {
  ACTIONS,
  ActionDef,
  CondLogic,
  ConditionGroup,
  ConditionLeaf,
  EVENTS,
  EventDef,
  FIELDS,
  OPERATORS,
  ScopeValue,
  RuleOutput,
  WorkflowRule,
  allowedFieldsForTriggers,
  condFieldDef,
  condFieldKey,
  condFieldKind,
  condFieldLabel,
  defaultParamFor,
  defaultValueFor,
  emptyRule,
  getAction,
  getEvent,
  isGroup,
  isValuelessOperator,
  opLabel,
  paramKeyFor,
  scopeLabel,
  walkLeaves,
} from '../../../core/vocabulary';
import { LJ_PRIMITIVES } from '../../../shared/lj/lj';
import { DraftEngineService } from '../data/draft-engine.service';
import { WorkflowsService } from '../data/workflows.service';
import { WorkflowsTabs } from '../ui/workflows-tabs';
import { predictWorkflowGhost } from '../ui/ghost-prediction';
import {
  SWEET_SPIRAL_STATUS,
  deriveSweetSpiralState,
} from '../ui/sweet-spiral.state';

type ComposerPhase = 'idle' | 'submitted' | 'parsing' | 'parser-error' | 'network-error';

/** "loan amount" → "Loan amount" for pill/card display (spec sentence case). */
function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ---- Structured builder pickers (Phase 1.5) ------------------------------ */

interface PickerEntry {
  key: string;
  label: string;
  emoji: string;
  unconfirmed: boolean;
}

interface PickerGroup {
  label: string;
  entries: PickerEntry[];
}

const EVENT_EMOJI_OVERRIDES: Record<string, string> = {
  'SIGNATURE COMPLETED': '✍️',
};

const EVENT_GROUP_SPECS: { label: string; emoji: string; keys: string[] }[] = [
  { label: 'Offers', emoji: '🤝', keys: ['OFFER ACCEPTED', 'OFFER MADE', 'OFFER REJECTED'] },
  { label: 'Underwriting', emoji: '⚖️', keys: ['LOAN APPROVED', 'LOAN REJECTED'] },
  {
    label: 'Booking Events',
    emoji: '🏦',
    keys: ['FISERV LOAN', 'FMAC LOAN', 'BOOKING STATUS CHANGED', 'SYSTEM ERROR'],
  },
  {
    label: 'Request Events',
    emoji: '📥',
    keys: ['REQUEST CREATED', 'REQUEST SUBMITTED', 'REQUEST STAGE CHANGED', 'REQUEST ASSIGNED'],
  },
  {
    label: 'Documents',
    emoji: '📎',
    keys: [
      'DOCUMENT UPLOADED',
      'DOCUMENT APPROVED',
      'DOCUMENT REJECTED',
      'CHECKLIST COMPLETED',
      'EXTRACTION COMPLETED',
    ],
  },
  { label: 'Credit', emoji: '💳', keys: ['CREDIT PULL COMPLETED'] },
];

const EVENT_PICKER_GROUPS: PickerGroup[] = (() => {
  const grouped = new Set(EVENT_GROUP_SPECS.flatMap((spec) => spec.keys));
  const rest = EVENTS.map((event) => event.key).filter((key) => !grouped.has(key));
  return [...EVENT_GROUP_SPECS, { label: 'Other / System', emoji: '📡', keys: rest }]
    .map((spec) => ({
      label: spec.label,
      entries: spec.keys
        .map((key) => getEvent(key))
        .filter((event): event is EventDef => !!event)
        .map((event) => ({
          key: event.key,
          label: event.label,
          emoji: EVENT_EMOJI_OVERRIDES[event.key] ?? spec.emoji,
          unconfirmed: event.confidence === 'unconfirmed',
        })),
    }))
    .filter((group) => group.entries.length > 0);
})();

const ACTION_EMOJI: Record<string, string> = {
  assign_user: '👤',
  route_to_queue: '🗂️',
  assign_authority: '⚖️',
  change_stage: '🔁',
  add_tag: '🏷️',
  remove_tag: '✂️',
  close_request: '🚪',
  set_underwriting_result: '🧾',
  request_document: '📎',
  assign_checklist: '📋',
  run_extraction: '🤖',
  request_signature: '✍️',
  notify: '🔔',
  pull_credit: '💳',
  make_offer: '🤝',
  trigger_booking: '🏦',
  log_event: '📡',
  send_webhook: '🔗',
};

const ACTION_GROUP_SPECS: { label: string; keys: string[] }[] = [
  { label: 'Routing', keys: ['assign_user', 'route_to_queue', 'assign_authority'] },
  { label: 'Requests', keys: ['change_stage', 'add_tag', 'remove_tag', 'close_request'] },
  { label: 'Underwriting', keys: ['set_underwriting_result'] },
  { label: 'Documents', keys: ['request_document', 'assign_checklist', 'run_extraction'] },
  { label: 'Signatures', keys: ['request_signature'] },
  { label: 'Comms', keys: ['notify'] },
  { label: 'Credit', keys: ['pull_credit'] },
  { label: 'Offers & Booking', keys: ['make_offer', 'trigger_booking'] },
];

const ACTION_PICKER_GROUPS: PickerGroup[] = (() => {
  const grouped = new Set(ACTION_GROUP_SPECS.flatMap((spec) => spec.keys));
  const rest = ACTIONS.map((action) => action.key).filter((key) => !grouped.has(key));
  return [...ACTION_GROUP_SPECS, { label: 'System', keys: rest }]
    .map((spec) => ({
      label: spec.label,
      entries: spec.keys
        .map((key) => getAction(key))
        .filter((action): action is ActionDef => !!action)
        .map((action) => ({
          key: action.key,
          label: action.label,
          emoji: ACTION_EMOJI[action.key] ?? '⚙️',
          unconfirmed: action.confidence === 'unconfirmed',
        })),
    }))
    .filter((group) => group.entries.length > 0);
})();

interface ConditionLeafCard {
  operator: string;
  operators: { value: string; label: string }[];
  valueless: boolean;
  /** Enum options (with an out-of-list current value prepended), or null → text input. */
  options: string[] | null;
  value: string;
  placeholder: string;
}

interface ConditionCard {
  index: number;
  label: string;
  leaf: ConditionLeafCard | null;
  note: string;
}

interface ActionCard {
  index: number;
  label: string;
  emoji: string;
  paramLabel: string;
  mode: 'none' | 'select' | 'text';
  options: string[];
  value: string;
}

type WorkflowReviewStatus = 'Confirmed' | 'Unconfirmed' | 'Needs clarification';

interface WorkflowReviewRow {
  connector: 'WHEN' | 'IF' | 'AND' | 'OR' | 'THEN' | 'ELSE';
  field: string;
  operator: string;
  value: string;
  status: WorkflowReviewStatus;
  statusKey: 'confirmed' | 'unconfirmed' | 'needs-clarification';
  depth: number;
  groupPath?: string;
}

/* ---- Workflow canvas diagram (Phase 1.7) --------------------------------- */

interface CanvasNode {
  id: number;
  type: 'event' | 'condition' | 'output';
  x: number;
  y: number;
  /** Index into the matching rule collection: triggers / conditions.children / actions. */
  ref: number;
}

interface CanvasEdge {
  from: number;
  to: number;
}

interface CanvasPoint {
  x: number;
  y: number;
}

const CANVAS_NODE_HALF_WIDTH = 76;
const CANVAS_NODE_HALF_HEIGHT = 34;
const CANVAS_TRASH_HEIGHT = 82;

/** Rank of each lane; also the flow direction a default connection follows. */
const CANVAS_TYPE_RANK: Record<CanvasNode['type'], number> = { event: 0, condition: 1, output: 2 };

/**
 * Deterministic node id from (type, ref). Stable across rebuilds — a re-parse,
 * an inspector edit, or a keystroke reproduces the SAME id for the same rule
 * piece, so manual positions, the current selection, and user-drawn edges all
 * survive the rebuild instead of being regenerated (the Phase 1.9.5 fix for the
 * "can't move/remove once connected" glitch). ref < 100000 by construction.
 */
function canvasNodeId(type: CanvasNode['type'], ref: number): number {
  return CANVAS_TYPE_RANK[type] * 100000 + ref;
}

/** Stable key for a directed edge, used by the add/remove override sets. */
function canvasEdgeKey(from: number, to: number): string {
  return `${from}->${to}`;
}

/**
 * Intersection of the line between two node centers and the edge of the
 * enterprise node card. Keeping the anchor on the actual card boundary makes
 * connections stay legible when a node is moved above, below, or behind its
 * neighbor instead of assuming every flow is left-to-right.
 */
function canvasNodeAnchor(from: CanvasPoint, toward: CanvasPoint): CanvasPoint {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  if (dx === 0 && dy === 0) return from;
  const scale = Math.min(
    CANVAS_NODE_HALF_WIDTH / Math.max(Math.abs(dx), 0.001),
    CANVAS_NODE_HALF_HEIGHT / Math.max(Math.abs(dy), 0.001)
  );
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

/** Shape-aware cubic connector that also handles vertical and reverse flows. */
function canvasConnectorPath(from: CanvasPoint, to: CanvasPoint): string {
  const start = canvasNodeAnchor(from, to);
  const end = canvasNodeAnchor(to, from);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const bend = Math.max(36, Math.abs(dx) * 0.42) * (dx >= 0 ? 1 : -1);
    return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
  }
  const bend = Math.max(36, Math.abs(dy) * 0.42) * (dy >= 0 ? 1 : -1);
  return `M ${start.x} ${start.y} C ${start.x} ${start.y + bend}, ${end.x} ${end.y - bend}, ${end.x} ${end.y}`;
}

/** Default trigger for a palette-placed event node — first entry of the first picker group. */
const DEFAULT_CANVAS_EVENT = EVENT_PICKER_GROUPS[0]?.entries[0]?.key ?? EVENTS[0].key;

@Component({
  selector: 'wf-workflow-composer-page',
  imports: [...LJ_PRIMITIVES, WorkflowsTabs],
  template: `
    <lj-page>
      <wf-workflows-tabs />
      <div class="composer-shell">
        <button type="button" class="back" (click)="back()">
          <span aria-hidden="true">←</span> Workflows
        </button>

        <section
          class="hero"
          aria-labelledby="composer-title"
        >
          <div class="hero-top">
            <div class="invitation">
              @if (!reviewing()) {
                <p class="eyebrow">Sweet · AI Workflow Assistant</p>
                <h1 id="composer-title">Describe an operation — I’ll compose the workflow.</h1>
              } @else {
                <p class="eyebrow">{{ gaps().length ? 'Let’s clarify the details' : 'Ready to review' }}</p>
                <h1 id="composer-title">
                  {{ gaps().length ? 'A little more context will make this precise.' : 'Here’s how I understand it.' }}
                </h1>
              }
            </div>
          </div>

          <form class="composer" (submit)="build($event)">
            <label class="sr-only" for="workflow-description">Describe the workflow</label>
            <textarea
              #composerInput
              id="workflow-description"
              rows="1"
              autocomplete="off"
              spellcheck="true"
              placeholder="Describe an automation, e.g. “When a loan is approved, assign to Underwriting Team and notify Wael.”"
              [value]="text()"
              [attr.aria-describedby]="focused() ? 'composer-guidance' : null"
              (focus)="focused.set(true)"
              (blur)="focused.set(false)"
              (input)="onInput($event)"
              (keydown)="onComposerKeydown($event)"
            ></textarea>
            @if (text().trim()) {
              <button type="submit" class="send" aria-label="Create workflow from this description">
                <span aria-hidden="true">↗</span>
              </button>
            }
          </form>

          <!-- Predictive ghost-text sub-bar: as the operator types, the assistant
               predicts the continuation of their phrase against the live
               vocabulary. Tab / → / clicking accepts it (see acceptGhost). -->
          @if (ghost(); as completion) {
            <div class="predictive-bar" role="group" aria-label="Predicted continuation">
              <span class="pi-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16"><path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z" /></svg>
              </span>
              <button
                type="button"
                class="pi-suggest"
                (mousedown)="$event.preventDefault()"
                (click)="acceptGhost()"
                [attr.aria-label]="'Accept prediction: ' + ghostPreviewText() + completion"
              >
                <span class="pi-ghost">
                  <span class="pi-typed">{{ ghostPreviewText() }}</span><span class="pi-completion">{{ completion }}</span>
                </span>
                <span class="pi-accept" aria-hidden="true">Tab</span>
              </button>
            </div>
          }

          @if (focused() || text()) {
            <p class="guidance" id="composer-guidance">
              Enter to continue <span aria-hidden="true">·</span> Shift + Enter for a new line
              @if (ghost()) {
                <span aria-hidden="true">·</span> Tab to accept the prediction
              }
            </p>
          }

          <p class="sr-only" aria-live="polite" aria-atomic="true">{{ liveStatus() }}</p>

          @if (unbackedNotes().length) {
            <div class="unbacked-note" role="status">
              <span class="unbacked-badge">Not backed by real data</span>
              <span>
                Using
                @for (value of unbackedNotes(); track value; let last = $last) {
                  <strong>{{ value }}</strong>{{ last ? '' : ', ' }}
                }
                — accepted so the workflow works, but not backed by real data.
              </span>
            </div>
          }

          <section class="visual-builder" aria-label="Structured workflow builder">
            @if (provisional()) {
              <p class="provisional-hint" role="status">
                Rough match from your description — highlighted picks are provisional.
                Click one to confirm it, or press Enter to review.
              </p>
            }
            <section class="builder-column" aria-labelledby="builder-triggers-title">
              <h2 class="column-header" id="builder-triggers-title">
                <span class="step" aria-hidden="true">1</span> Trigger event
              </h2>
              <input
                class="column-search"
                type="search"
                placeholder="Search events…"
                aria-label="Search events"
                [value]="eventSearch()"
                (input)="eventSearch.set($any($event.target).value)"
              />
              <div class="option-list">
                @for (group of eventGroups(); track group.label) {
                  <p class="group-label">{{ group.label }}</p>
                  @for (entry of group.entries; track entry.key) {
                    <button
                      type="button"
                      class="option"
                      [class.selected]="selectedEvents().has(entry.key)"
                      [attr.aria-pressed]="selectedEvents().has(entry.key)"
                      (click)="selectTrigger(entry.key)"
                    >
                      <span class="option-icon" aria-hidden="true">
                        <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" /><path d="M8 4.5v3.8l2.5 1.5" /></svg>
                      </span>
                      <span class="option-label">{{ entry.label }}</span>
                      @if (entry.unconfirmed) {
                        <span class="unconfirmed" title="Not yet confirmed against the live platform">unconfirmed</span>
                      }
                    </button>
                  }
                } @empty {
                  <p class="zero">No events match “{{ eventSearch() }}”.</p>
                }
              </div>
            </section>

            <section class="builder-column" aria-labelledby="builder-conditions-title">
              <h2 class="column-header" id="builder-conditions-title">
                <span class="step" aria-hidden="true">2</span> Conditions
              </h2>
              @if (!selectedEvents().size) {
                <p class="zero">Pick a trigger event first.</p>
              } @else {
                <div class="pill-row">
                  @for (field of conditionFields(); track field.key) {
                    <button type="button" class="pill" (click)="addCondition(field.key)">
                      + {{ field.label }}
                    </button>
                  }
                </div>
                @if (conditionCards().length) {
                  <div class="cards">
                    @for (card of conditionCards(); track card.index) {
                      @if (card.index > 0) {
                        <select
                          class="logic"
                          aria-label="Combine conditions with"
                          (change)="setLogic($any($event.target).value)"
                        >
                          <option value="AND" [selected]="logic() === 'AND'">AND</option>
                          <option value="OR" [selected]="logic() === 'OR'">OR</option>
                        </select>
                      }
                      <article class="card">
                        <header class="card-head">
                          <h3>{{ card.label }}</h3>
                          <button
                            type="button"
                            class="remove"
                            (click)="removeCondition(card.index)"
                            [attr.aria-label]="'Remove condition: ' + card.label"
                          ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg></button>
                        </header>
                        @if (card.leaf; as leaf) {
                          <div class="card-controls">
                            <select
                              [attr.aria-label]="'Operator for ' + card.label"
                              (change)="setConditionOperator(card.index, $any($event.target).value)"
                            >
                              @for (op of leaf.operators; track op.value) {
                                <option [value]="op.value" [selected]="op.value === leaf.operator">
                                  {{ op.label }}
                                </option>
                              }
                            </select>
                            @if (!leaf.valueless) {
                              @if (leaf.options; as options) {
                                <select
                                  [attr.aria-label]="'Value for ' + card.label"
                                  (change)="setConditionValue(card.index, $any($event.target).value)"
                                >
                                  @if (!leaf.value) {
                                    <option value="" selected disabled>Choose…</option>
                                  }
                                  @for (option of options; track option) {
                                    <option [value]="option" [selected]="option === leaf.value">
                                      {{ option }}
                                    </option>
                                  }
                                </select>
                              } @else {
                                <input
                                  type="text"
                                  [attr.aria-label]="'Value for ' + card.label"
                                  [placeholder]="leaf.placeholder"
                                  [value]="leaf.value"
                                  (input)="setConditionValue(card.index, $any($event.target).value)"
                                />
                              }
                            }
                          </div>
                        } @else {
                          <p class="group-note">{{ card.note }}</p>
                        }
                      </article>
                    }
                  </div>
                }
              }
            </section>

            <section class="builder-column" aria-labelledby="builder-outputs-title">
              <h2 class="column-header" id="builder-outputs-title">
                <span class="step" aria-hidden="true">3</span> Outputs
              </h2>
              <input
                class="column-search"
                type="search"
                placeholder="Search actions…"
                aria-label="Search actions"
                [value]="actionSearch()"
                (input)="actionSearch.set($any($event.target).value)"
              />
              <div class="option-list">
                @for (group of actionGroups(); track group.label) {
                  <p class="group-label">{{ group.label }}</p>
                  @for (entry of group.entries; track entry.key) {
                    <button type="button" class="option" (click)="addAction(entry.key)">
                      <span class="option-icon" aria-hidden="true">
                        <svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="2" /><path d="m6 8 1.5 1.5L10.5 6" /></svg>
                      </span>
                      <span class="option-label">{{ entry.label }}</span>
                      @if (entry.unconfirmed) {
                        <span class="unconfirmed" title="Not yet confirmed against the live platform">unconfirmed</span>
                      }
                    </button>
                  }
                } @empty {
                  <p class="zero">No actions match “{{ actionSearch() }}”.</p>
                }
              </div>
              @if (actionCards().length) {
                <div class="cards">
                  @for (card of actionCards(); track card.index) {
                    <article class="card">
                      <header class="card-head">
                        <h3>
                          <span class="card-icon" aria-hidden="true">
                            <svg viewBox="0 0 16 16"><path d="M3 8h9m-3-3 3 3-3 3" /></svg>
                          </span>
                          {{ card.label }}
                        </h3>
                        <button
                          type="button"
                          class="remove"
                          (click)="removeAction(card.index)"
                          [attr.aria-label]="'Remove action: ' + card.label"
                        ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg></button>
                      </header>
                      @if (card.mode === 'select') {
                        <div class="card-controls">
                          <select
                            [attr.aria-label]="card.paramLabel + ' for ' + card.label"
                            (change)="setActionParam(card.index, $any($event.target).value)"
                          >
                            @if (!card.value) {
                              <option value="" selected disabled>Choose…</option>
                            }
                            @for (option of card.options; track option) {
                              <option [value]="option" [selected]="option === card.value">
                                {{ option }}
                              </option>
                            }
                          </select>
                        </div>
                      } @else if (card.mode === 'text') {
                        <div class="card-controls">
                          <input
                            type="text"
                            [attr.aria-label]="card.paramLabel + ' for ' + card.label"
                            [placeholder]="card.paramLabel"
                            [value]="card.value"
                            (input)="setActionParam(card.index, $any($event.target).value)"
                          />
                        </div>
                      }
                    </article>
                  }
                </div>
              }
            </section>
          </section>

          <section class="canvas-diagram" aria-label="Workflow diagram canvas">
            <div class="canvas-header">
              <div class="canvas-heading-group">
                <h2 class="canvas-title">Workflow diagram</h2>
                <p>{{ canvasNodes().length }} nodes · {{ canvasEdges().length }} connections</p>
              </div>
              <div class="canvas-toolbar" aria-label="Diagram tools">
                <button type="button" class="canvas-btn ghost" (click)="arrangeCanvas()">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12M2 8h12M2 13h12M4 1v4m4 1v4m4 1v4" /></svg>
                  Arrange
                </button>
              </div>
            </div>

            <div class="canvas-body">
              <aside class="canvas-palette" aria-label="Node library">
                <p class="palette-heading">Node library</p>
                <p class="palette-intro">Click to add and connect automatically, or drag to place.</p>
                <button
                  type="button"
                  class="palette-node"
                  draggable="true"
                  (dragstart)="paletteDragStart($event, 'event')"
                  (click)="paletteClick('event')"
                >
                  <span class="pnode-shape event-shape" aria-hidden="true"><span></span></span>
                  <span class="palette-copy"><strong>Trigger</strong><small>Starts the workflow</small></span>
                  <span class="palette-add" aria-hidden="true">+</span>
                </button>
                <button
                  type="button"
                  class="palette-node"
                  draggable="true"
                  (dragstart)="paletteDragStart($event, 'condition')"
                  (click)="paletteClick('condition')"
                >
                  <span class="pnode-shape cond-shape" aria-hidden="true"><span></span></span>
                  <span class="palette-copy"><strong>Condition</strong><small>Evaluates a rule</small></span>
                  <span class="palette-add" aria-hidden="true">+</span>
                </button>
                <button
                  type="button"
                  class="palette-node"
                  draggable="true"
                  (dragstart)="paletteDragStart($event, 'output')"
                  (click)="paletteClick('output')"
                >
                  <span class="pnode-shape output-shape" aria-hidden="true"><span></span></span>
                  <span class="palette-copy"><strong>Action</strong><small>Completes the work</small></span>
                  <span class="palette-add" aria-hidden="true">+</span>
                </button>
                <p class="palette-hint">Drag a node’s right handle onto another node to connect. Click an arrow’s × to remove it.</p>
              </aside>

              <div
                class="canvas-stage"
                #canvasStage
                [class.is-node-dragging]="draggingCanvasNodeId() !== null"
                [class.is-trash-hot]="trashHot()"
                (dragover)="$event.preventDefault()"
                (drop)="canvasDrop($event)"
              >
                <svg class="canvas-svg" aria-hidden="true">
                  <defs>
                    <marker id="wf-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
                      <path class="canvas-arrow" d="M0,0 L8,3 L0,6 Z" />
                    </marker>
                  </defs>
                  @for (edge of edgePaths(); track edge.key) {
                    <path class="canvas-edge" [attr.d]="edge.d" marker-end="url(#wf-arrow)" />
                    <path
                      class="canvas-edge-hit"
                      [attr.d]="edge.d"
                      (pointerdown)="$event.stopPropagation()"
                      (click)="removeCanvasEdge(edge, $event)"
                    >
                      <title>{{ edge.label }} (click to remove)</title>
                    </path>
                  }
                  @if (tempEdgePath(); as d) {
                    <path class="canvas-edge canvas-edge-temp" [attr.d]="d" />
                  }
                </svg>
                @if (!canvasNodes().length) {
                  <div class="canvas-empty">
                    <span class="canvas-empty-icon" aria-hidden="true"></span>
                    <strong>Build the workflow visually</strong>
                    <p>Add a trigger, condition, or action. Nodes connect automatically as the rule grows.</p>
                  </div>
                }
                @for (node of canvasNodes(); track node.id) {
                  <div
                    class="canvas-node"
                    role="button"
                    tabindex="0"
                    [class.cn-event]="node.type === 'event'"
                    [class.cn-condition]="node.type === 'condition'"
                    [class.cn-output]="node.type === 'output'"
                    [class.cn-selected]="selectedCanvasNodeId() === node.id"
                    [class.cn-dragging]="draggingCanvasNodeId() === node.id"
                    [style.left.px]="node.x"
                    [style.top.px]="node.y"
                    [attr.data-node-id]="node.id"
                    [attr.aria-label]="canvasNodeTypeLabel(node) + ': ' + canvasNodeLabel(node)"
                    (pointerdown)="nodePointerDown($event, node)"
                    (keydown.enter)="selectCanvasNode(node.id)"
                    (keydown.space)="$event.preventDefault(); selectCanvasNode(node.id)"
                  >
                    <span class="cn-port cn-port-in" aria-hidden="true"></span>
                    <span class="cn-accent" aria-hidden="true"></span>
                    <span class="cn-content">
                      <small>{{ canvasNodeTypeLabel(node) }}</small>
                      <strong>{{ canvasNodeLabel(node) }}</strong>
                      <span>{{ canvasNodeCaption(node) || 'Needs configuration' }}</span>
                    </span>
                    <span
                      class="cn-port cn-port-out"
                      title="Drag to connect"
                      aria-hidden="true"
                      (pointerdown)="portPointerDown($event, node)"
                    ></span>
                  </div>
                }

                <!-- Delete-connection handles: one × at each arrow midpoint, so
                     removing an arrow is discoverable (clicking the thin line
                     also works). Hidden while dragging a node. -->
                @if (draggingCanvasNodeId() === null) {
                  @for (edge of edgePaths(); track edge.key) {
                    <button
                      type="button"
                      class="canvas-edge-del"
                      [style.left.px]="edge.mx"
                      [style.top.px]="edge.my"
                      [attr.aria-label]="edge.label"
                      [title]="edge.label"
                      (pointerdown)="$event.stopPropagation()"
                      (click)="removeCanvasEdge(edge, $event)"
                    >×</button>
                  }
                }

                <div
                  class="canvas-trash"
                  [class.hot]="trashHot()"
                  role="status"
                  aria-live="polite"
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5.5h13M8 2.75h4M5.5 5.5l.75 11h7.5l.75-11M8 8.5v5m4-5v5" /></svg>
                  <span>
                    <strong>{{ trashHot() ? 'Release to remove node' : 'Drag down to remove' }}</strong>
                    <small>The workflow rule updates immediately</small>
                  </span>
                </div>
              </div>

              <aside class="canvas-inspector" aria-label="Node inspector">
                @if (selectedCanvasNode(); as node) {
                  <div class="inspector-head">
                    <p class="inspector-title">Selected node</p>
                    <span>{{ canvasNodeTypeLabel(node) }}</span>
                  </div>
                  @if (node.type === 'event') {
                    <label class="insp-label" for="canvas-event">Event</label>
                    <select
                      id="canvas-event"
                      class="insp-select"
                      (change)="setCanvasNodeEvent(node.id, $any($event.target).value)"
                    >
                      @for (group of eventGroups(); track group.label) {
                        <optgroup [label]="group.label">
                          @for (entry of group.entries; track entry.key) {
                            <option [value]="entry.key" [selected]="canvasNodeEventKey(node) === entry.key">
                              {{ entry.label }}
                            </option>
                          }
                        </optgroup>
                      }
                    </select>
                  }
                  @if (node.type === 'condition') {
                    <label class="insp-label" for="canvas-field">Condition field</label>
                    <select
                      id="canvas-field"
                      class="insp-select"
                      (change)="setCanvasNodeField(node.id, $any($event.target).value)"
                    >
                      @for (field of conditionFields(); track field.key) {
                        <option [value]="field.key" [selected]="canvasNodeFieldKey(node) === field.key">
                          {{ field.label }}
                        </option>
                      }
                    </select>
                    <label class="insp-label" for="canvas-operator">Operator</label>
                    <select
                      id="canvas-operator"
                      class="insp-select"
                      (change)="setCanvasNodeOperator(node.id, $any($event.target).value)"
                    >
                      @for (op of canvasNodeOperators(node); track op.value) {
                        <option [value]="op.value" [selected]="canvasNodeOperator(node) === op.value">
                          {{ op.label }}
                        </option>
                      }
                    </select>
                    <label class="insp-label" for="canvas-value">Value</label>
                    <input
                      id="canvas-value"
                      class="insp-input"
                      [value]="canvasNodeValue(node)"
                      (input)="setCanvasNodeValue(node.id, $any($event.target).value)"
                    />
                  }
                  @if (node.type === 'output') {
                    <label class="insp-label" for="canvas-action">Action</label>
                    <select
                      id="canvas-action"
                      class="insp-select"
                      (change)="setCanvasNodeAction(node.id, $any($event.target).value)"
                    >
                      @for (group of actionGroups(); track group.label) {
                        <optgroup [label]="group.label">
                          @for (entry of group.entries; track entry.key) {
                            <option [value]="entry.key" [selected]="canvasNodeActionKey(node) === entry.key">
                              {{ entry.label }}
                            </option>
                          }
                        </optgroup>
                      }
                    </select>
                    @if (canvasNodeActionCard(node); as card) {
                      @if (card.mode !== 'none') {
                        <label class="insp-label" for="canvas-param">{{ card.paramLabel }}</label>
                        @if (card.mode === 'select') {
                          <select
                            id="canvas-param"
                            class="insp-select"
                            (change)="setCanvasNodeParam(node.id, $any($event.target).value)"
                          >
                            @if (!card.value) {
                              <option value="" selected disabled>Choose…</option>
                            }
                            @for (opt of card.options; track opt) {
                              <option [value]="opt" [selected]="card.value === opt">{{ opt }}</option>
                            }
                          </select>
                        } @else {
                          <input
                            id="canvas-param"
                            class="insp-input"
                            [value]="card.value"
                            (input)="setCanvasNodeParam(node.id, $any($event.target).value)"
                          />
                        }
                      }
                    }
                  }
                  <p class="inspector-sync">Changes sync to the workflow description automatically.</p>
                  <button class="insp-delete" type="button" (click)="deleteCanvasNode(node.id)">Remove node</button>
                  <button class="insp-save" type="button" (click)="commitCanvasToRule()">Apply changes</button>
                } @else {
                  <div class="insp-empty">
                    <span aria-hidden="true"></span>
                    <strong>Select a node</strong>
                    <p>Its workflow settings will appear here.</p>
                  </div>
                }
              </aside>
            </div>
          </section>
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
                  <span class="journey-number">{{ step.number }}</span><span class="journey-label">{{ step.label }}</span>
                </li>
              }
            </ol>
          </nav>

          <article class="workflow-review report-shell" aria-labelledby="workflow-review-title">
            <header class="review-header">
              <div class="review-title-block">
                <p class="eyebrow">Workflow review</p>
                <h2 id="workflow-review-title">{{ draftName() }}</h2>
                <p class="review-summary">{{ interpretation()?.summary }}</p>
                <details class="plain-checks">
                  <summary>What Sweet understood</summary>
                  <ul>
                    @for (item of interpretation()?.checklist; track $index) {
                      <li>{{ item }}</li>
                    }
                  </ul>
                </details>
              </div>
              <dl class="review-metadata metadata-strip">
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span class="review-status status-chip" [attr.data-status]="reviewStatusKey(reviewState())">
                      {{ reviewState() }}
                    </span>
                  </dd>
                </div>
                <div><dt>Version</dt><dd>Rule schema v{{ builderRule()?.schemaVersion }}</dd></div>
                <div><dt>Last updated</dt><dd>Unsaved draft</dd></div>
              </dl>
            </header>

            <div class="review-sequence">
              <section class="review-step" aria-labelledby="review-trigger-title">
                <div class="review-marker" aria-hidden="true">1</div>
                <div class="review-step-body">
                  <header><p>WHEN</p><h3 id="review-trigger-title">Trigger</h3></header>
                  <div class="flow-table" role="table" aria-label="Workflow trigger">
                    <div class="flow-head" role="row"><span role="columnheader">Logic</span><span role="columnheader">Field</span><span role="columnheader">Operator</span><span role="columnheader">Value</span><span role="columnheader">Status</span></div>
                    @for (row of reviewTriggerRows(); track $index) {
                      <div class="flow-row structured-row" role="row">
                        <strong class="flow-keyword" role="cell">{{ row.connector }}</strong>
                        <span class="flow-cell" role="cell"><small>Field</small>{{ row.field }}</span>
                        <span class="flow-cell" role="cell"><small>Operator</small>{{ row.operator }}</span>
                        <span class="flow-cell" role="cell"><small>Value</small>{{ row.value }}</span>
                        <span class="review-status status-chip" role="cell" [attr.data-status]="row.statusKey">{{ row.status }}</span>
                      </div>
                    }
                  </div>
                </div>
              </section>

              <section class="review-step" aria-labelledby="review-conditions-title">
                <div class="review-marker" aria-hidden="true">2</div>
                <div class="review-step-body">
                  <header><p>IF</p><h3 id="review-conditions-title">Conditions</h3></header>
                  @if (reviewConditionRows().length) {
                    <div class="flow-table" role="table" aria-label="Workflow conditions">
                      <div class="flow-head" role="row"><span role="columnheader">Logic</span><span role="columnheader">Field</span><span role="columnheader">Operator</span><span role="columnheader">Value</span><span role="columnheader">Status</span></div>
                      @for (row of reviewConditionRows(); track $index) {
                        <div class="flow-row structured-row" role="row">
                          <strong class="flow-keyword" role="cell">{{ row.connector }}</strong>
                          <span class="flow-cell" role="cell" [style.padding-left.px]="row.depth * 12"><small>Field</small>@if (row.groupPath) { <span class="group-context">Grouping: {{ row.groupPath }}</span> }{{ row.field }}</span>
                          <span class="flow-cell" role="cell"><small>Operator</small>{{ row.operator }}</span>
                          <span class="flow-cell" role="cell"><small>Value</small>{{ row.value }}</span>
                          <span class="review-status status-chip" role="cell" [attr.data-status]="row.statusKey">{{ row.status }}</span>
                        </div>
                      }
                    </div>
                  } @else {
                    <p class="structured-empty">No conditions are configured.</p>
                  }

                  @if (gaps().length) {
                    <div class="clarification-callout" aria-labelledby="clarification-title">
                      <div class="clarification-heading">
                        <span class="review-status status-chip" data-status="needs-clarification">Needs clarification</span>
                        <div>
                          <h4 id="clarification-title">{{ gaps().length }} detail{{ gaps().length === 1 ? '' : 's' }} need your answer</h4>
                          <p>Sweet won’t activate a partial interpretation. Choose only what you intend.</p>
                        </div>
                      </div>
                      <div class="review-questions">
                        @for (question of visibleQuestions(); track question.id) {
                          <article class="question">
                            <p>{{ question.question }}</p>
                            <div class="answer-row">
                              @for (option of question.options; track option) {
                                <button type="button" (click)="answer(question, option)">{{ option }}</button>
                              }
                              @if (question.allowDismiss) {
                                <button type="button" class="quiet" (click)="dismiss(question)">Intentionally leave it out</button>
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
                      </div>
                      @if (gapNotes().length) {
                        <ul class="gap-notes">
                          @for (note of gapNotes(); track note) { <li>{{ note }}</li> }
                        </ul>
                      }
                      @if (visibleQuestions().length && gaps().length > visibleQuestions().length) {
                        <p class="more">{{ gaps().length - visibleQuestions().length }} more after these.</p>
                      }
                    </div>
                  }
                </div>
              </section>

              <section class="review-step" aria-labelledby="review-actions-title">
                <div class="review-marker" aria-hidden="true">3</div>
                <div class="review-step-body">
                  <header><p>THEN</p><h3 id="review-actions-title">Actions</h3></header>
                  @if (reviewActionRows().length) {
                    <div class="flow-table" role="table" aria-label="Workflow actions">
                      <div class="flow-head" role="row"><span role="columnheader">Logic</span><span role="columnheader">Action</span><span role="columnheader">Parameter</span><span role="columnheader">Value</span><span role="columnheader">Status</span></div>
                      @for (row of reviewActionRows(); track $index) {
                        <div class="flow-row structured-row" role="row">
                          <strong class="flow-keyword" role="cell">{{ row.connector }}</strong>
                          <span class="flow-cell" role="cell"><small>Action</small>{{ row.field }}</span>
                          <span class="flow-cell" role="cell"><small>Parameter</small>{{ row.operator }}</span>
                          <span class="flow-cell" role="cell"><small>Value</small>{{ row.value }}</span>
                          <span class="review-status status-chip" role="cell" [attr.data-status]="row.statusKey">{{ row.status }}</span>
                        </div>
                      }
                    </div>
                  } @else {
                    <p class="structured-empty">No actions are configured.</p>
                  }
                </div>
              </section>

              <section class="review-step" aria-labelledby="review-else-title">
                <div class="review-marker" aria-hidden="true">4</div>
                <div class="review-step-body">
                  <header><p>ELSE</p><h3 id="review-else-title">Non-matching behavior</h3></header>
                  @if (reviewElseRows().length) {
                    <div class="flow-table" role="table" aria-label="Non-matching workflow actions">
                      <div class="flow-head" role="row"><span role="columnheader">Logic</span><span role="columnheader">Action</span><span role="columnheader">Parameter</span><span role="columnheader">Value</span><span role="columnheader">Status</span></div>
                      @for (row of reviewElseRows(); track $index) {
                        <div class="flow-row structured-row" role="row">
                          <strong class="flow-keyword" role="cell">{{ row.connector }}</strong>
                          <span class="flow-cell" role="cell"><small>Action</small>{{ row.field }}</span>
                          <span class="flow-cell" role="cell"><small>Parameter</small>{{ row.operator }}</span>
                          <span class="flow-cell" role="cell"><small>Value</small>{{ row.value }}</span>
                          <span class="review-status status-chip" role="cell" [attr.data-status]="row.statusKey">{{ row.status }}</span>
                        </div>
                      }
                    </div>
                  } @else {
                    <p class="structured-empty">{{ nonMatchingSummary() }}</p>
                  }
                </div>
              </section>

              <section class="review-step" aria-labelledby="review-safeguards-title">
                <div class="review-marker" aria-hidden="true">5</div>
                <div class="review-step-body">
                  <header><p>SAFE</p><h3 id="review-safeguards-title">Safeguards</h3></header>
                  <ul class="safeguard-rows">
                    @for (protection of protections(); track protection.title) {
                      <li>
                        <div><strong>{{ protection.title }}</strong><p>{{ protection.description }}</p></div>
                        <span class="review-status status-chip" data-status="confirmed">Confirmed</span>
                      </li>
                    }
                  </ul>
                </div>
              </section>

              <section class="review-step" aria-labelledby="simulation-title">
                <div class="review-marker" aria-hidden="true">6</div>
                <div class="review-step-body">
                  <header><p>TEST</p><h3 id="simulation-title">Test results</h3></header>
                  @if (simulation(); as sim) {
                    <p class="test-caption">Tried against {{ sim.tested }} recent requests</p>
                    <div class="test-totals" aria-label="Simulation outcome summary">
                      <button type="button" [class.active]="filter() === 'run'" [attr.aria-pressed]="filter() === 'run'" (click)="filter.set('run')"><strong>{{ sim.wouldRun }}</strong><span>Would run</span></button>
                      <button type="button" [class.active]="filter() === 'skip'" [attr.aria-pressed]="filter() === 'skip'" (click)="filter.set('skip')"><strong>{{ sim.wouldSkip }}</strong><span>Would skip</span></button>
                      <button type="button" [class.active]="filter() === 'needs_data'" [attr.aria-pressed]="filter() === 'needs_data'" (click)="filter.set('needs_data')"><strong>{{ sim.needsData }}</strong><span>Could not evaluate</span></button>
                    </div>
                    <button type="button" class="show-all" [attr.aria-pressed]="filter() === 'all'" (click)="filter.set('all')">Show every outcome</button>
                    <div class="test-results">
                      @for (result of filteredResults(); track result.requestId) {
                        <details class="test-result">
                          <summary>
                            <span class="request-id">{{ result.requestId }}</span>
                            <span>{{ result.requestName }}</span>
                            <span class="review-status status-chip" [attr.data-status]="result.outcome">{{ result.outcome === 'run' ? 'Would run' : result.outcome === 'skip' ? 'Would skip' : 'Could not evaluate' }}</span>
                          </summary>
                          <p>{{ result.explanation }}</p>
                          @if (result.actions.length) {
                            <ul>@for (action of result.actions; track $index) { <li>{{ action }}</li> }</ul>
                          }
                          @if (result.checks.length) {
                            <ul class="test-checks">
                              @for (check of result.checks; track $index) { <li><strong>{{ check.state }}</strong>{{ check.label }}</li> }
                            </ul>
                          }
                        </details>
                      }
                    </div>
                  } @else {
                    <div class="test-blocked"><span class="review-status status-chip" data-status="needs-clarification">Could not evaluate</span><p>Answer the open questions to continue.</p></div>
                  }
                </div>
              </section>
            </div>

            <section class="review-refine" aria-labelledby="revise-title">
              <div><h3 id="revise-title">Change it conversationally</h3></div>
              <form class="review-revise" (submit)="revise($event)">
                <label class="sr-only" for="workflow-revision">Describe a change</label>
                <input id="workflow-revision" type="text" [value]="revisionText()" (input)="revisionText.set($any($event.target).value)" placeholder="Raise the amount to $500,000." />
                <button type="submit" [disabled]="!revisionText().trim()">Apply change</button>
              </form>
              @if (revisionNote(); as note) { <p class="feedback success" role="status">Updated. {{ note }}</p> }
              @if (revisionError(); as message) { <p class="feedback warning" role="alert">{{ message }}</p> }
            </section>

            <footer class="review-footer" [class.blocked]="gaps().length">
              <div>
                <p class="eyebrow">{{ gaps().length ? 'Waiting for clarity' : 'Safe by default' }}</p>
                <h2>{{ gaps().length ? 'Answer the open questions to continue.' : 'Start by observing what would happen.' }}</h2>
              </div>
              <button type="button" class="observe" [disabled]="gaps().length > 0 || parsedDescription() !== text().trim() || saving()" (click)="save()">
                {{ saving() ? (session.mustProposeWorkflow() ? 'Proposing…' : 'Starting…') : (session.mustProposeWorkflow() ? 'Propose workflow' : 'Start observing') }} <span aria-hidden="true">↗</span>
              </button>
            </footer>
          </article>
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
      min-height: 36px; display: inline-flex; align-items: center; gap: var(--space-2);
      margin-left: 0; padding: 0; border: 0; background: transparent;
      color: var(--text-dim); font-size: var(--text-sm); font-weight: 700; cursor: pointer;
    }
    .back:hover { color: var(--text); }
    .hero { width: 100%; margin: 0 auto; padding: var(--space-2) 0 var(--space-8); }
    .hero-top { display: flex; align-items: center; gap: var(--space-4); }
    .spiral-wrap { width: 72px; height: 72px; flex: none; }
    .invitation { min-width: 0; }
    h1 {
      margin: var(--space-1) 0 0; font-size: clamp(1.65rem, 2.4vw, 2rem);
      line-height: 1.12; letter-spacing: -.035em; font-weight: 760;
    }
    .composer {
      position: relative; display: flex; align-items: flex-end; margin-top: var(--space-4);
      border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
      box-shadow: var(--shadow-soft);
    }
    textarea {
      width: 100%; min-height: 3.25rem; max-height: 14rem; padding: .85rem 3.5rem .85rem 1rem;
      border: 0; outline: 0; resize: none; overflow: hidden; color: var(--text); background: transparent;
      font-size: var(--text-md); line-height: 1.5; caret-color: var(--brand);
    }
    textarea::placeholder { color: var(--text-soft); opacity: 1; }
    .send {
      position: absolute; right: .5rem; bottom: .45rem; width: 2.35rem; height: 2.35rem;
      border: 0; border-radius: var(--radius-md); background: var(--brand); color: white;
      font-weight: 900; cursor: pointer; transition: background var(--motion-fast) ease;
    }
    .send:hover { background: var(--brand-hover); }
    .guidance { margin: var(--space-2) 0 0; color: var(--text-soft); font-size: var(--text-xs); }
    /* The predictive ghost-text sub-bar (.predictive-bar / .pi-*) is a
       page-scoped partial in styles.scss — kept out of component styles to stay
       under the anyComponentStyle budget, same precedent as the canvas rules. */

    /* ---- Structured visual builder (Phase 1.5) ---- */
    .visual-builder {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0;
      margin-top: var(--space-5);
      align-items: stretch;
      overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-lg);
      background: var(--surface); box-shadow: var(--shadow-soft);
    }
    .builder-column {
      display: flex; flex-direction: column; gap: var(--space-3);
      background: var(--surface);
      border: 0;
      border-radius: 0;
      padding: var(--space-4);
      min-height: 420px;
      box-shadow: none;
    }
    .builder-column + .builder-column { border-left: 1px solid var(--border); }
    .column-header {
      display: flex; align-items: center; gap: var(--space-2); margin: 0;
      font-size: var(--text-md); letter-spacing: -.015em; font-weight: 780;
    }
    .step {
      width: 1.5rem; height: 1.5rem; display: grid; place-items: center; flex: none;
      border-radius: 50%; background: var(--brand); color: white;
      font-size: var(--text-xs); font-weight: 800;
    }
    .provisional-hint {
      grid-column: 1 / -1; margin: 0; padding: var(--space-2) var(--space-3);
      border: 0; border-bottom: 1px dashed var(--border-strong); border-radius: 0;
      color: var(--text-dim); font-size: var(--text-xs); font-weight: 650;
    }
    .column-search, .card-controls select, .card-controls input, .logic {
      min-height: 38px; padding: .35rem .6rem; border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm); background: var(--surface); color: var(--text);
      font-size: var(--text-sm);
    }
    .column-search:focus, .card-controls select:focus, .card-controls input:focus, .logic:focus {
      border-color: var(--brand);
    }
    .column-search {
      width: 100%; min-height: 38px; padding-inline: .75rem;
      border-color: var(--border); border-radius: var(--radius-md); background: var(--surface-inset);
    }
    .column-search:focus { background: var(--surface); }
    .option-list { display: flex; flex-direction: column; gap: 2px; max-height: 330px; overflow-y: auto; }
    .group-label {
      margin: var(--space-3) 0 var(--space-1); color: var(--text-soft);
      font-size: var(--text-xs); font-weight: 800; letter-spacing: .09em; text-transform: uppercase;
    }
    .group-label:first-child { margin-top: 0; }
    .option {
      display: flex; align-items: center; gap: var(--space-2); min-height: 38px; padding: .4rem .6rem;
      border: 1px solid transparent; border-radius: var(--radius-md); background: transparent;
      color: var(--text); font-size: var(--text-sm); font-weight: 650; text-align: left; cursor: pointer;
    }
    .option:hover { background: var(--surface-inset); border-color: var(--border); }
    .option.selected { background: var(--brand); border-color: var(--brand); color: white; }
    .option.selected .unconfirmed { color: inherit; }
    .option-label { flex: 1; min-width: 0; }
    .option-icon, .card-icon { width: 1rem; height: 1rem; display: inline-grid; place-items: center; flex: none; color: var(--text-soft); }
    .option-icon svg, .card-icon svg, .remove svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
    .option.selected .option-icon { color: white; }
    .unconfirmed {
      flex: none; color: var(--warn-text); font-size: .6rem; font-weight: 800;
      letter-spacing: .06em; text-transform: uppercase;
    }
    .zero { margin: 0; color: var(--text-dim); font-size: var(--text-sm); }
    .pill-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .pill {
      min-height: 34px; padding: .3rem .75rem; border: 1px solid var(--border-strong);
      border-radius: var(--radius-md); background: var(--surface-inset); color: var(--text);
      font-size: var(--text-xs); font-weight: 750; cursor: pointer;
    }
    .pill:hover { border-color: var(--brand); color: var(--brand-text); }
    .cards { display: flex; flex-direction: column; gap: var(--space-2); }
    .card {
      border: 1px solid var(--border); border-radius: var(--radius-md);
      background: var(--surface-inset); padding: var(--space-3);
    }
    .card-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
    .card-head h3 { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-size: var(--text-sm); font-weight: 760; }
    .remove { width: 28px; height: 28px; flex: none; padding: 6px; border: 0; background: transparent; color: var(--text-soft); cursor: pointer; }
    .remove:hover { color: var(--danger); }
    .card-controls { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); margin-top: var(--space-2); }
    .card-controls select, .card-controls input { width: 100%; min-width: 0; }
    .card-controls select:only-child, .card-controls input:only-child { grid-column: 1 / -1; }
    .logic {
      align-self: center; min-height: 34px; border-radius: var(--radius-md);
      font-size: var(--text-xs); font-weight: 800; cursor: pointer;
    }
    .group-note { margin: var(--space-2) 0 0; color: var(--text-dim); font-size: var(--text-xs); }

    .notice { width: min(100%, 880px); margin: 0 auto var(--space-10); padding: var(--space-5) 0; border-block: 1px solid currentColor; }
    .notice p { margin: .25rem 0; }
    .notice-kicker { font-weight: 800; }
    .notice.error { color: var(--danger); }
    .journey { width: min(100%, 1160px); margin: 0 auto var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
    .journey ol { display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--space-3); margin: 0; padding: var(--space-2) var(--space-4); list-style: none; }
    .journey li { display: flex; align-items: center; gap: var(--space-2); color: var(--text-soft); font-size: var(--text-xs); font-weight: 750; }
    .journey li .journey-number { width: 1.5rem; height: 1.5rem; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 50%; }
    .journey li.done { color: var(--text); }
    .journey li.done .journey-number { border-color: var(--brand); background: var(--brand); color: white; }
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
    .gap-notes { margin: var(--space-4) 0 0; padding-left: 1.1rem; color: var(--warn-text); font-size: var(--text-sm); }
    .gap-notes li { margin: .3rem 0; }
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
    @media (max-width: 900px) {
      .hero { padding-top: 0; }
      .visual-builder { grid-template-columns: 1fr; }
      .builder-column { min-height: auto; }
      .builder-column + .builder-column { border-top: 1px solid var(--border); border-left: 0; }
      .review-section { grid-template-columns: 7rem 1fr; }
    }
    @media (max-width: 620px) {
      .composer-shell { padding-top: var(--space-3); }
      .hero-top { gap: var(--space-4); }
      .spiral-wrap { width: 72px; height: 72px; }
      h1 { font-size: clamp(1.35rem, 6vw, 1.75rem); }
      .review-section { grid-template-columns: 1fr; gap: var(--space-3); padding: var(--space-10) 0; }
      .journey ol { min-width: 0; gap: var(--space-1); padding-inline: var(--space-2); }
      .journey li { justify-content: center; }
      .journey-label { display: none; }
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
export class WorkflowComposerPage implements AfterViewInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly service = inject(WorkflowsService);
  private readonly engine = inject(DraftEngineService);
  protected readonly session = inject(UserSessionService);
  private readonly injector = inject(Injector);
  private buildGeneration = 0;
  private spinTimer: ReturnType<typeof setTimeout> | null = null;

  @ViewChild('composerInput') private composerInput?: ElementRef<HTMLTextAreaElement>;

  protected readonly text = signal('');

  /**
   * Predictive ghost text. `ghostRaw` is the raw prediction for the current
   * text (used by acceptGhost, so a click that momentarily blurs the textarea
   * still resolves the completion). `ghost` is the display-gated view: only
   * shown while the operator is actively composing — focused, with text, and
   * before a rule has been drafted (once reviewing, the assistant's attention
   * moves to the report, not the input).
   */
  protected readonly ghostRaw = computed(() => predictWorkflowGhost(this.text()));
  protected readonly ghost = computed(() =>
    this.focused() && !this.reviewing() && this.text().trim() ? this.ghostRaw() : ''
  );
  /** Trailing slice of what's typed, shown muted before the highlighted completion. */
  protected readonly ghostPreviewText = computed(() => {
    const text = this.text();
    const tail = text.slice(-42);
    return tail.length < text.length ? `…${tail}` : tail;
  });

  protected readonly result = signal<ParseResult | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly focused = signal(false);
  protected readonly typingPulse = signal(0);
  protected readonly spinPulse = signal(0);
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
    // Author-time empty-value gate (Phase 1.6): validateRule tolerates empty
    // values, but a builder-seeded '' condition or param must never reach
    // save — Number('') is 0 and an empty assignee notifies nobody.
    const authoringIssues: string[] = [];
    if (result.rule) {
      for (const leaf of walkLeaves(result.rule.conditions)) {
        if (!isValuelessOperator(leaf.operator) && !scopeLabel(leaf.value).trim()) {
          authoringIssues.push(`Pick a value for “${condFieldLabel(leaf.field)}”.`);
        }
      }
      for (const output of [...result.rule.actions, ...(result.rule.else ?? [])]) {
        const def = getAction(output.action);
        if (def && def.paramKind !== 'none' && !scopeLabel(output.params[paramKeyFor(def.key)]).trim()) {
          authoringIssues.push(`Pick a ${def.paramLabel || 'value'} for “${def.label}”.`);
        }
      }
    }
    return [...new Set([...parseIssues, ...validationIssues, ...authoringIssues])];
  });
  /** Values accepted under permissive authoring (Phase 1.9.5) that match no
   *  vocabulary option — surfaced as a non-blocking "not backed by real data"
   *  notice so the rule still works but the author knows the field is unbacked. */
  protected readonly unbackedNotes = computed<string[]>(() => {
    const values = this.result()?.unbacked ?? [];
    return [...new Set(values)];
  });
  /** Gap messages with no interactive question — rendered as a plain list so a
   *  validation-only block never becomes an unexplained dead end. */
  protected readonly gapNotes = computed(() =>
    this.visibleQuestions().length ? [] : this.gaps()
  );
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

  /* ---- Structured visual builder state (Phase 1.5 / 1.6) ---- */

  protected readonly eventSearch = signal('');
  protected readonly actionSearch = signal('');

  /**
   * Live rough-match parse of the description while the user types (Phase
   * 1.6). Display-only until committed: the builder renders it so triggers/
   * conditions/actions light up as they are recognized, and the first builder
   * click adopts it as the working rule.
   */
  protected readonly liveResult = signal<ParseResult | null>(null);

  protected readonly rule = computed(() => this.result()?.rule ?? null);
  /** What the builder columns render: the committed rule, else the live rough match. */
  protected readonly builderRule = computed(
    () => this.result()?.rule ?? this.liveResult()?.rule ?? null
  );
  protected readonly provisional = computed(
    () => !this.result() && this.liveResult()?.rule != null
  );
  protected readonly selectedEvents = computed(
    () => new Set((this.builderRule()?.triggers ?? []).map((trigger) => trigger.event))
  );
  protected readonly logic = computed<CondLogic>(() => this.builderRule()?.conditions.logic ?? 'AND');

  protected readonly eventGroups = computed<PickerGroup[]>(() => {
    const query = this.eventSearch().trim().toLowerCase();
    if (!query) return EVENT_PICKER_GROUPS;
    return EVENT_PICKER_GROUPS.map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => entry.label.toLowerCase().includes(query)),
    })).filter((group) => group.entries.length > 0);
  });

  protected readonly actionGroups = computed<PickerGroup[]>(() => {
    const query = this.actionSearch().trim().toLowerCase();
    if (!query) return ACTION_PICKER_GROUPS;
    return ACTION_PICKER_GROUPS.map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => entry.label.toLowerCase().includes(query)),
    })).filter((group) => group.entries.length > 0);
  });

  protected readonly conditionFields = computed(() => {
    const rule = this.builderRule();
    if (!rule || rule.triggers.length === 0) return [];
    return allowedFieldsForTriggers(rule.triggers.map((trigger) => trigger.event)).map((field) => ({
      key: field.key,
      label: sentence(field.label),
    }));
  });

  protected readonly conditionCards = computed<ConditionCard[]>(() => {
    const rule = this.builderRule();
    if (!rule) return [];
    return rule.conditions.children.map((node, index) => {
      if (isGroup(node)) {
        const count = walkLeaves(node).length;
        return {
          index,
          label: 'Condition group',
          leaf: null,
          note: `${count} grouped condition${count === 1 ? '' : 's'} from the description — refine it conversationally below.`,
        };
      }
      const def = condFieldDef(node.field);
      const value = scopeLabel(node.value);
      const options = def?.options ?? null;
      return {
        index,
        label: sentence(condFieldLabel(node.field)),
        leaf: {
          operator: node.operator,
          operators: OPERATORS[condFieldKind(node.field)],
          valueless: isValuelessOperator(node.operator),
          options: options ? (value && !options.includes(value) ? [value, ...options] : options) : null,
          value,
          placeholder: def?.unit ? `Amount (${def.unit})` : 'Value',
        },
        note: '',
      };
    });
  });

  protected readonly actionCards = computed<ActionCard[]>(() => {
    const rule = this.builderRule();
    if (!rule) return [];
    return rule.actions.map((output, index) => {
      const def = getAction(output.action);
      const paramKey = def ? paramKeyFor(def.key) : 'value';
      const value = scopeLabel(output.params[paramKey]);
      const mode: ActionCard['mode'] =
        !def || def.paramKind === 'none' ? 'none' : def.paramOptions?.length ? 'select' : 'text';
      const base = def?.paramOptions ?? [];
      return {
        index,
        label: def?.label ?? output.action,
        emoji: ACTION_EMOJI[output.action] ?? '⚙️',
        paramLabel: def?.paramLabel || 'value',
        mode,
        options: mode === 'select' && value && !base.includes(value) ? [value, ...base] : base,
        value,
      };
    });
  });

  protected readonly reviewState = computed<WorkflowReviewStatus>(() => {
    if (this.gaps().length) return 'Needs clarification';
    const rows = [
      ...this.reviewTriggerRows(),
      ...this.reviewConditionRows(),
      ...this.reviewActionRows(),
      ...this.reviewElseRows(),
    ];
    return rows.some((row) => row.status === 'Unconfirmed') ? 'Unconfirmed' : 'Confirmed';
  });

  protected readonly nonMatchingSummary = computed(() => {
    const checks = this.interpretation()?.checklist ?? [];
    return checks[checks.length - 1] ?? '';
  });

  protected draftName(): string {
    return this.nameForDescription(this.text().trim());
  }

  protected reviewStatusKey(status: WorkflowReviewStatus): WorkflowReviewRow['statusKey'] {
    if (status === 'Needs clarification') return 'needs-clarification';
    return status === 'Unconfirmed' ? 'unconfirmed' : 'confirmed';
  }

  protected reviewTriggerRows(): WorkflowReviewRow[] {
    return (this.builderRule()?.triggers ?? []).map((trigger, index) => {
      const event = getEvent(trigger.event);
      const scope = trigger.scope ? scopeLabel(trigger.scope) : '';
      const status = this.reviewStatus(event?.confidence, !event);
      return {
        connector: index === 0 ? 'WHEN' : 'OR',
        field: 'Event',
        operator: 'is',
        value: `${event?.label ?? trigger.event}${scope ? ` · ${scope}` : ''}`,
        status,
        statusKey: this.reviewStatusKey(status),
        depth: 0,
      };
    });
  }

  protected reviewConditionRows(): WorkflowReviewRow[] {
    const root = this.builderRule()?.conditions;
    if (!root) return [];
    const rows: WorkflowReviewRow[] = [];
    const visit = (
      group: ConditionGroup,
      depth: number,
      logicPath: string[],
      entryConnector: 'IF' | CondLogic
    ) => {
      for (const [index, node] of group.children.entries()) {
        const connector = rows.length === 0 ? 'IF' : index === 0 ? entryConnector : group.logic;
        if (isGroup(node)) {
          visit(
            node,
            depth + 1,
            [...logicPath, `Group ${index + 1} · ${node.logic}`],
            connector
          );
          continue;
        }
        const field = condFieldDef(node.field);
        const valueless = isValuelessOperator(node.operator);
        const value = scopeLabel(node.value);
        const status = this.reviewStatus(field?.confidence, !field || (!valueless && !value.trim()));
        rows.push({
          connector,
          field: sentence(condFieldLabel(node.field)),
          operator: opLabel(condFieldKind(node.field), node.operator),
          value: valueless ? '—' : value || '—',
          status,
          statusKey: this.reviewStatusKey(status),
          depth,
          groupPath: logicPath.join(' › '),
        });
      }
    };
    visit(root, 0, [`Root · ${root.logic}`], 'IF');
    return rows;
  }

  protected reviewActionRows(): WorkflowReviewRow[] {
    return this.reviewOutputRows(this.builderRule()?.actions ?? [], 'THEN');
  }

  protected reviewElseRows(): WorkflowReviewRow[] {
    return this.reviewOutputRows(this.builderRule()?.else ?? [], 'ELSE');
  }

  private reviewOutputRows(
    outputs: RuleOutput[],
    connector: 'THEN' | 'ELSE'
  ): WorkflowReviewRow[] {
    return outputs.map((output) => {
      const action = getAction(output.action);
      const parameter = action ? scopeLabel(output.params[paramKeyFor(action.key)]) : '';
      const incomplete = !action || (action.paramKind !== 'none' && !parameter.trim());
      const status = this.reviewStatus(action?.confidence, incomplete);
      return {
        connector,
        field: sentence(action?.label ?? output.action),
        operator: action?.paramKind === 'none' ? '—' : action?.paramLabel || 'value',
        value: action?.paramKind === 'none' ? '—' : parameter || '—',
        status,
        statusKey: this.reviewStatusKey(status),
        depth: 0,
      };
    });
  }

  private reviewStatus(confidence: string | undefined, incomplete: boolean): WorkflowReviewStatus {
    if (incomplete || !confidence) return 'Needs clarification';
    return confidence === 'unconfirmed' ? 'Unconfirmed' : 'Confirmed';
  }

  ngAfterViewInit() {
    requestAnimationFrame(() => this.composerInput?.nativeElement.focus());
  }

  ngOnDestroy() {
    this.cancelTypeOut();
    if (this.spinTimer !== null) clearTimeout(this.spinTimer);
  }

  /* ---- Builder → text type-out (Phase 1.6) ----
   * The canonical description is typed into the cursor character by character,
   * pulsing the Sweet spiral like real typing. Restarts snap to the common
   * prefix so successive edits only retype the changed tail. Honors
   * prefers-reduced-motion (instant set), and any manual keystroke or Enter
   * cancels the animation. */

  private typeTimer: ReturnType<typeof setInterval> | null = null;

  private cancelTypeOut() {
    if (this.typeTimer != null) {
      clearInterval(this.typeTimer);
      this.typeTimer = null;
    }
  }

  private typeOut(target: string) {
    this.cancelTypeOut();
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.text.set(target);
      this.syncComposerHeight();
      return;
    }
    const current = this.text();
    let prefix = 0;
    while (prefix < current.length && prefix < target.length && current[prefix] === target[prefix]) {
      prefix++;
    }
    this.text.set(target.slice(0, prefix));
    this.syncComposerHeight();
    this.typeTimer = setInterval(() => {
      const now = this.text();
      if (now.length >= target.length) {
        this.cancelTypeOut();
        return;
      }
      this.text.set(target.slice(0, Math.min(target.length, now.length + 2)));
      this.typingPulse.update((pulse) => pulse + 1);
      this.syncComposerHeight();
    }, 16);
  }

  private syncComposerHeight() {
    const el = this.composerInput?.nativeElement;
    if (!el) return;
    requestAnimationFrame(() => {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 224)}px`;
    });
  }

  /* ---- Workflow canvas diagram (Phase 1.7, editable in 1.9.5) ----
   * Spatial view of the same rule signal. Rule → canvas: an effect rebuilds
   * whenever the rule changes from the parser, the live rough match, or the
   * 3-column builder. Canvas → rule: every structural canvas mutation is a
   * surgical immutable patch on the rule piece a node points at (node.ref =
   * index into triggers / conditions.children / actions), funneled through
   * updateRule(). Node ids are STABLE (derived from type+ref), so a rebuild
   * carries manual positions, the selection, and user-drawn edges forward
   * instead of regenerating them — that is what makes nodes movable/removable
   * and arrows add/deletable once connected (1.9.5). Edges render reactively
   * from signals — no imperative SVG writes. Nested condition groups stay in
   * the rule untouched; the canvas shows root-level leaves. */

  @ViewChild('canvasStage') private canvasStage?: ElementRef<HTMLDivElement>;

  protected readonly canvasNodes = signal<CanvasNode[]>([]);
  protected readonly canvasEdges = signal<CanvasEdge[]>([]);
  protected readonly selectedCanvasNodeId = signal<number | null>(null);
  protected readonly tempEdge = signal<{ fromId: number; x: number; y: number } | null>(null);
  protected readonly draggingCanvasNodeId = signal<number | null>(null);
  protected readonly trashHot = signal(false);

  // User edge overrides, keyed by canvasEdgeKey. `edgesAdded` are arrows the
  // user drew on top of the canonical topology; `edgesRemoved` are canonical
  // arrows the user deleted. Both are keyed by the STABLE node ids, so they
  // survive every rebuild — that is what makes add/delete arrow persistent.
  private readonly edgesAdded = new Set<string>();
  private readonly edgesRemoved = new Set<string>();

  protected readonly selectedCanvasNode = computed(
    () => this.canvasNodes().find((node) => node.id === this.selectedCanvasNodeId()) ?? null
  );
  protected readonly edgePaths = computed(() => {
    const byId = new Map(this.canvasNodes().map((node) => [node.id, node]));
    const paths: { key: string; d: string; from: number; to: number; label: string; mx: number; my: number }[] = [];
    for (const edge of this.canvasEdges()) {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (a && b) {
        paths.push({
          key: `${edge.from}-${edge.to}`,
          d: canvasConnectorPath(a, b),
          from: edge.from,
          to: edge.to,
          mx: (a.x + b.x) / 2,
          my: (a.y + b.y) / 2,
          label: `Remove connection ${this.canvasNodeLabel(a)} → ${this.canvasNodeLabel(b)}`,
        });
      }
    }
    return paths;
  });

  protected readonly tempEdgePath = computed(() => {
    const edge = this.tempEdge();
    if (!edge) return null;
    const from = this.canvasNodes().find((node) => node.id === edge.fromId);
    return from ? canvasConnectorPath(from, edge) : null;
  });

  private readonly canvasSync = effect(() => {
    // The canvas is a pure projection of the working rule: it rebuilds on every
    // change. There is no "canvas-sourced" guard — a rebuild now PRESERVES
    // manual node positions, the current selection, and user-drawn edges (all
    // keyed by stable ids), so a canvas-originated edit no longer needs to skip
    // its own rebuild to avoid clobbering itself.
    const rule = this.builderRule();
    // Everything after the tracked builderRule() read runs untracked: the
    // rebuild READS canvasNodes/selection to carry them forward and also WRITES
    // them, so tracking those reads would make the effect depend on its own
    // output and loop. The effect's only dependency is the working rule.
    untracked(() => {
      if (!rule) {
        this.canvasNodes.set([]);
        this.canvasEdges.set([]);
        this.selectedCanvasNodeId.set(null);
        return;
      }
      this.rebuildCanvasFromRule(rule);
    });
  });

  private rebuildCanvasFromRule(rule: WorkflowRule) {
    // Carry the current positions forward so a rebuild never snaps a node the
    // user moved back to its lane. Stable ids make this a plain id lookup.
    const prev = new Map(this.canvasNodes().map((node) => [node.id, { x: node.x, y: node.y }]));
    const nodes: CanvasNode[] = [];
    rule.triggers.forEach((_, i) =>
      nodes.push({ id: canvasNodeId('event', i), type: 'event', x: 0, y: 0, ref: i })
    );
    const leafRefs = rule.conditions.children
      .map((child, i) => (isGroup(child) ? -1 : i))
      .filter((i) => i >= 0);
    leafRefs.forEach((childIndex) =>
      nodes.push({ id: canvasNodeId('condition', childIndex), type: 'condition', x: 0, y: 0, ref: childIndex })
    );
    rule.actions.forEach((_, i) =>
      nodes.push({ id: canvasNodeId('output', i), type: 'output', x: 0, y: 0, ref: i })
    );
    const laidOut = this.layoutCanvasNodes(nodes).map((node) => {
      const kept = prev.get(node.id);
      return kept ? { ...node, ...kept } : node;
    });
    this.canvasNodes.set(laidOut);
    this.canvasEdges.set(this.resolveCanvasEdges(laidOut));
    // Keep the selection if its node still exists (survives typing / edits).
    if (!laidOut.some((node) => node.id === this.selectedCanvasNodeId())) {
      this.selectedCanvasNodeId.set(null);
    }
  }

  /** Compact three-lane layout sized from the actual canvas, including mobile. */
  private layoutCanvasNodes(nodes: CanvasNode[]): CanvasNode[] {
    const stage = this.canvasStage?.nativeElement;
    const width = Math.max(320, stage?.clientWidth ?? 760);
    const height = Math.max(380, stage?.clientHeight ?? 520);
    const inset = Math.min(150, Math.max(82, width * 0.18));
    const laneX: Record<CanvasNode['type'], number> = {
      event: inset,
      condition: width / 2,
      output: width - inset,
    };
    const positioned = new Map<number, CanvasPoint>();
    for (const type of ['event', 'condition', 'output'] as const) {
      const lane = nodes.filter((node) => node.type === type).sort((a, b) => a.ref - b.ref);
      const top = 58;
      const bottom = Math.max(top, height - CANVAS_TRASH_HEIGHT - 24);
      const span = Math.min(Math.max(0, lane.length - 1) * 92, bottom - top);
      const start = (top + bottom - span) / 2;
      lane.forEach((node, index) => {
        positioned.set(node.id, {
          x: laneX[type],
          y: lane.length > 1 ? start + index * (span / (lane.length - 1)) : (top + bottom) / 2,
        });
      });
    }
    return nodes.map((node) => ({ ...node, ...positioned.get(node.id)! }));
  }

  /** The canonical rule topology. It heals the chain after add/remove. */
  private canonicalCanvasEdges(nodes: CanvasNode[]): CanvasEdge[] {
    const events = nodes.filter((node) => node.type === 'event').sort((a, b) => a.ref - b.ref);
    const conds = nodes.filter((node) => node.type === 'condition').sort((a, b) => a.ref - b.ref);
    const outputs = nodes.filter((node) => node.type === 'output').sort((a, b) => a.ref - b.ref);
    const edges: CanvasEdge[] = [];
    if (conds.length) {
      for (const event of events) edges.push({ from: event.id, to: conds[0].id });
      for (let i = 0; i < conds.length - 1; i++) edges.push({ from: conds[i].id, to: conds[i + 1].id });
      for (const output of outputs) edges.push({ from: conds[conds.length - 1].id, to: output.id });
    } else {
      for (const event of events) for (const output of outputs) edges.push({ from: event.id, to: output.id });
    }
    return edges;
  }

  /**
   * Rendered edges = canonical topology, plus the user's added arrows, minus the
   * user's removed arrows — then filtered to arrows whose endpoints still exist.
   * Deterministic and crash-safe: a stale override (e.g. an endpoint deleted, or
   * a ref that shifted after a delete) is simply dropped, never rendered.
   */
  private resolveCanvasEdges(nodes: CanvasNode[]): CanvasEdge[] {
    const ids = new Set(nodes.map((node) => node.id));
    const keys = new Set<string>();
    for (const edge of this.canonicalCanvasEdges(nodes)) keys.add(canvasEdgeKey(edge.from, edge.to));
    for (const key of this.edgesAdded) keys.add(key);
    for (const key of this.edgesRemoved) keys.delete(key);
    const edges: CanvasEdge[] = [];
    for (const key of keys) {
      const [from, to] = key.split('->').map(Number);
      if (ids.has(from) && ids.has(to) && from !== to) edges.push({ from, to });
    }
    return edges;
  }

  /** Recompute the rendered edges from the current nodes + override sets. */
  private refreshCanvasEdges() {
    this.canvasEdges.set(this.resolveCanvasEdges(this.canvasNodes()));
  }

  /* ---- Canvas: palette + stage interactions ---- */

  protected paletteDragStart(e: DragEvent, type: CanvasNode['type']) {
    e.dataTransfer?.setData('nodeType', type);
  }

  protected paletteClick(type: CanvasNode['type']) {
    this.addCanvasNode(type, 0, 0, true);
  }

  protected canvasDrop(e: DragEvent) {
    e.preventDefault();
    const type = e.dataTransfer?.getData('nodeType') as CanvasNode['type'] | '';
    if (type !== 'event' && type !== 'condition' && type !== 'output') return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.addCanvasNode(type, e.clientX - rect.left, e.clientY - rect.top, false);
  }

  protected arrangeCanvas() {
    // Deterministic reset: re-lay-out every node AND drop the user's edge
    // overrides so the diagram returns to the clean canonical topology.
    this.edgesAdded.clear();
    this.edgesRemoved.clear();
    const nodes = this.layoutCanvasNodes(this.canvasNodes());
    this.canvasNodes.set(nodes);
    this.canvasEdges.set(this.resolveCanvasEdges(nodes));
    this.tempEdge.set(null);
    this.typingPulse.update((pulse) => pulse + 1);
    this.pulseSpiral();
  }

  protected selectCanvasNode(id: number) {
    this.selectedCanvasNodeId.set(id);
  }

  protected nodePointerDown(e: PointerEvent, node: CanvasNode) {
    if ((e.target as HTMLElement).classList.contains('cn-port') || e.button !== 0) return;
    e.preventDefault();
    this.selectedCanvasNodeId.set(node.id);
    const stage = this.canvasStage?.nativeElement;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const offsetX = e.clientX - rect.left - node.x;
    const offsetY = e.clientY - rect.top - node.y;
    this.draggingCanvasNodeId.set(node.id);
    this.trashHot.set(false);
    this.typingPulse.update((pulse) => pulse + 1);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const localX = ev.clientX - rect.left;
      const localY = ev.clientY - rect.top;
      const insideX = localX >= 0 && localX <= rect.width;
      this.trashHot.set(insideX && localY >= rect.height - CANVAS_TRASH_HEIGHT && localY <= rect.height);
      const x = Math.max(
        CANVAS_NODE_HALF_WIDTH + 8,
        Math.min(rect.width - CANVAS_NODE_HALF_WIDTH - 8, localX - offsetX)
      );
      const y = Math.max(
        CANVAS_NODE_HALF_HEIGHT + 8,
        Math.min(rect.height - CANVAS_NODE_HALF_HEIGHT - 8, localY - offsetY)
      );
      this.canvasNodes.update((nodes) => nodes.map((n) => (n.id === node.id ? { ...n, x, y } : n)));
    };
    let finished = false;
    let finish: (ev: PointerEvent) => void;
    let mouseFinish: () => void;
    const completeDrag = () => {
      if (finished) return;
      finished = true;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      document.removeEventListener('mouseup', mouseFinish);
      const remove = this.trashHot();
      this.draggingCanvasNodeId.set(null);
      this.trashHot.set(false);
      if (remove) this.deleteCanvasNode(node.id);
      else this.pulseSpiral();
    };
    finish = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      completeDrag();
    };
    mouseFinish = () => completeDrag();
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
    document.addEventListener('mouseup', mouseFinish);
  }

  protected portPointerDown(e: PointerEvent, fromNode: CanvasNode) {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    const stage = this.canvasStage?.nativeElement;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    this.tempEdge.set({ fromId: fromNode.id, x: fromNode.x, y: fromNode.y });
    this.typingPulse.update((pulse) => pulse + 1);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      this.tempEdge.set({ fromId: fromNode.id, x: ev.clientX - rect.left, y: ev.clientY - rect.top });
    };
    let finished = false;
    let finish: (ev: PointerEvent) => void;
    let mouseFinish: (ev: MouseEvent) => void;
    const completeConnection = (target: EventTarget | null) => {
      if (finished) return;
      finished = true;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      document.removeEventListener('mouseup', mouseFinish);
      this.tempEdge.set(null);
      const element = target instanceof HTMLElement ? target : null;
      const destination = element?.closest?.('[data-node-id]');
      const targetId = destination ? Number(destination.getAttribute('data-node-id')) : NaN;
      if (Number.isFinite(targetId) && targetId !== fromNode.id) {
        this.addCanvasEdge(fromNode.id, targetId);
      }
    };
    finish = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      completeConnection(ev.target);
    };
    mouseFinish = (ev: MouseEvent) => completeConnection(ev.target);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
    document.addEventListener('mouseup', mouseFinish);
  }

  private addCanvasEdge(from: number, to: number) {
    const fromNode = this.canvasNodes().find((node) => node.id === from);
    const toNode = this.canvasNodes().find((node) => node.id === to);
    if (!fromNode || !toNode || !this.canConnectCanvasNodes(fromNode, toNode)) return;
    const key = canvasEdgeKey(from, to);
    // Record the intent in the override sets so the arrow survives rebuilds; a
    // previously-removed same arrow is un-removed.
    this.edgesRemoved.delete(key);
    this.edgesAdded.add(key);
    this.refreshCanvasEdges();
    this.pulseSpiral();
  }

  /** Delete an arrow: suppress it if canonical, or drop it if user-added. */
  protected removeCanvasEdge(edge: CanvasEdge, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    const key = canvasEdgeKey(edge.from, edge.to);
    this.edgesAdded.delete(key);
    this.edgesRemoved.add(key);
    this.refreshCanvasEdges();
    this.typingPulse.update((pulse) => pulse + 1);
    this.pulseSpiral();
  }

  /** Arrows are visual annotations, so any two distinct nodes may connect;
   *  duplicates are collapsed by the override set's key. */
  private canConnectCanvasNodes(from: CanvasNode, to: CanvasNode): boolean {
    return from.id !== to.id;
  }

  /* ---- Canvas: add / delete nodes (each maps to a rule piece) ---- */

  private addCanvasNode(type: CanvasNode['type'], x: number, y: number, autoArrange: boolean) {
    const base = this.baseRule();
    let ref: number;
    let rule: WorkflowRule;
    if (type === 'event') {
      ref = base.triggers.length;
      rule = { ...base, triggers: [...base.triggers, { event: DEFAULT_CANVAS_EVENT }] };
    } else if (type === 'condition') {
      const fieldKey = this.conditionFields()[0]?.key ?? 'stage';
      const field = FIELDS[fieldKey] ?? FIELDS['stage'];
      const leaf: ConditionLeaf = {
        field: field.key,
        operator: OPERATORS[field.kind][0].value,
        value: defaultValueFor(field),
      };
      ref = base.conditions.children.length;
      rule = {
        ...base,
        conditions: { ...base.conditions, children: [...base.conditions.children, leaf] },
      };
    } else {
      const def = getAction('assign_user');
      if (!def) return;
      ref = base.actions.length;
      rule = { ...base, actions: [...base.actions, { action: def.key, params: defaultParamFor(def) }] };
    }
    const id = canvasNodeId(type, ref);
    // Drag-drop keeps the drop point; a palette click lets the rebuild lane the
    // new node. Either way we pre-seed the node so the rebuild's position-carry
    // preserves it, and select it. The rebuild (via updateRule) is the single
    // place that reconciles nodes/edges with the rule.
    if (!autoArrange) {
      const stage = this.canvasStage?.nativeElement;
      const width = Math.max(320, stage?.clientWidth ?? 760);
      const height = Math.max(380, stage?.clientHeight ?? 520);
      const placed: CanvasNode = {
        id,
        type,
        ref,
        x: Math.max(CANVAS_NODE_HALF_WIDTH + 8, Math.min(width - CANVAS_NODE_HALF_WIDTH - 8, x)),
        y: Math.max(CANVAS_NODE_HALF_HEIGHT + 8, Math.min(height - CANVAS_TRASH_HEIGHT - 16, y)),
      };
      this.canvasNodes.update((nodes) => [...nodes, placed]);
    }
    this.selectedCanvasNodeId.set(id);
    this.updateRule(rule);
  }

  protected deleteCanvasNode(id: number) {
    const node = this.canvasNodes().find((n) => n.id === id);
    if (!node) return;
    const base = this.baseRule();
    let rule: WorkflowRule | null = null;
    if (node.type === 'event' && base.triggers[node.ref]) {
      rule = { ...base, triggers: base.triggers.filter((_, i) => i !== node.ref) };
    } else if (node.type === 'condition' && base.conditions.children[node.ref]) {
      rule = {
        ...base,
        conditions: {
          ...base.conditions,
          children: base.conditions.children.filter((_, i) => i !== node.ref),
        },
      };
    } else if (node.type === 'output' && base.actions[node.ref]) {
      rule = { ...base, actions: base.actions.filter((_, i) => i !== node.ref) };
    }
    // Re-index siblings in the same lane and recompute their stable ids, keeping
    // their manual positions so a delete never scrambles the rest of the lane.
    const remaining = this.canvasNodes()
      .filter((n) => n.id !== id)
      .map((n) =>
        n.type === node.type && n.ref > node.ref
          ? { ...n, ref: n.ref - 1, id: canvasNodeId(n.type, n.ref - 1) }
          : n
      );
    this.canvasNodes.set(remaining);
    this.pruneEdgeOverrides(remaining);
    this.canvasEdges.set(this.resolveCanvasEdges(remaining));
    if (this.selectedCanvasNodeId() === id) this.selectedCanvasNodeId.set(null);
    if (rule) this.updateRule(rule);
  }

  /** Drop override keys whose endpoints no longer exist (keeps the sets bounded
   *  after deletes / re-indexes; resolveCanvasEdges already ignores them). */
  private pruneEdgeOverrides(nodes: CanvasNode[]) {
    const ids = new Set(nodes.map((n) => n.id));
    for (const set of [this.edgesAdded, this.edgesRemoved]) {
      for (const key of set) {
        const [from, to] = key.split('->').map(Number);
        if (!ids.has(from) || !ids.has(to)) set.delete(key);
      }
    }
  }

  /** "Save workflow": re-commit the working rule (composes the description,
   *  re-runs the gap gate + review flow; commits a provisional rough match). */
  protected commitCanvasToRule() {
    const rule = this.builderRule();
    if (!rule) return;    this.updateRule(rule);
  }

  /* ---- Canvas: node ↔ rule lookups for labels + inspector ---- */

  private findCanvasNode(id: number, type: CanvasNode['type']): CanvasNode | null {
    return this.canvasNodes().find((n) => n.id === id && n.type === type) ?? null;
  }

  private canvasLeaf(node: CanvasNode): ConditionLeaf | null {
    const child = this.baseRule().conditions.children[node.ref];
    return child && !isGroup(child) ? child : null;
  }

  protected canvasNodeLabel(node: CanvasNode): string {
    const base = this.baseRule();
    if (node.type === 'event') return base.triggers[node.ref]?.event ?? 'Event';
    if (node.type === 'condition') {
      const leaf = this.canvasLeaf(node);
      return leaf ? sentence(condFieldLabel(leaf.field)) : 'Condition';
    }
    const output = base.actions[node.ref];
    return output ? getAction(output.action)?.label ?? output.action : 'Output';
  }

  protected canvasNodeTypeLabel(node: CanvasNode): string {
    if (node.type === 'event') return 'Trigger';
    if (node.type === 'condition') return 'Condition';
    return 'Action';
  }

  protected canvasNodeCaption(node: CanvasNode): string {
    const base = this.baseRule();
    if (node.type === 'event') {
      const key = base.triggers[node.ref]?.event;
      return key
        ? EVENT_PICKER_GROUPS.find((group) => group.entries.some((entry) => entry.key === key))?.label ?? ''
        : '';
    }
    if (node.type === 'condition') {
      const leaf = this.canvasLeaf(node);
      if (!leaf) return '';
      const op = opLabel(condFieldKind(leaf.field), leaf.operator);
      return isValuelessOperator(leaf.operator) ? op : `${op} ${scopeLabel(leaf.value) || '…'}`;
    }
    const output = base.actions[node.ref];
    if (!output) return '';
    const def = getAction(output.action);
    return def && def.paramKind !== 'none' ? scopeLabel(output.params[paramKeyFor(def.key)]) : '';
  }

  protected canvasNodeEventKey(node: CanvasNode): string {
    return this.baseRule().triggers[node.ref]?.event ?? '';
  }

  protected canvasNodeFieldKey(node: CanvasNode): string {
    const leaf = this.canvasLeaf(node);
    return leaf ? condFieldKey(leaf.field) : '';
  }

  protected canvasNodeOperators(node: CanvasNode): { value: string; label: string }[] {
    const leaf = this.canvasLeaf(node);
    return leaf ? OPERATORS[condFieldKind(leaf.field)] : [];
  }

  protected canvasNodeOperator(node: CanvasNode): string {
    return this.canvasLeaf(node)?.operator ?? '';
  }

  protected canvasNodeValue(node: CanvasNode): string {
    const leaf = this.canvasLeaf(node);
    return leaf ? scopeLabel(leaf.value) : '';
  }

  protected canvasNodeActionKey(node: CanvasNode): string {
    return this.baseRule().actions[node.ref]?.action ?? '';
  }

  protected canvasNodeActionCard(node: CanvasNode): ActionCard | null {
    return this.actionCards().find((card) => card.index === node.ref) ?? null;
  }

  /* ---- Canvas: inspector → rule (all via updateRule, guard set first) ---- */

  protected setCanvasNodeEvent(id: number, eventKey: string) {
    const node = this.findCanvasNode(id, 'event');
    if (!node || !getEvent(eventKey)) return;
    const base = this.baseRule();
    if (!base.triggers[node.ref] || base.triggers[node.ref].event === eventKey) return;    this.updateRule({
      ...base,
      triggers: base.triggers.map((trigger, i) =>
        i === node.ref ? { ...trigger, event: eventKey } : trigger
      ),
    });
  }

  protected setCanvasNodeField(id: number, fieldKey: string) {
    const node = this.findCanvasNode(id, 'condition');
    const field = FIELDS[fieldKey];
    if (!node || !field) return;
    const leaf = this.canvasLeaf(node);
    if (!leaf || condFieldKey(leaf.field) === fieldKey) return;
    const replacement: ConditionLeaf = {
      field: field.key,
      operator: OPERATORS[field.kind][0].value,
      value: defaultValueFor(field),
    };
    const base = this.baseRule();    this.updateRule({
      ...base,
      conditions: {
        ...base.conditions,
        children: base.conditions.children.map((child, i) => (i === node.ref ? replacement : child)),
      },
    });
  }

  protected setCanvasNodeOperator(id: number, operator: string) {
    const node = this.findCanvasNode(id, 'condition');
    if (!node || !this.canvasLeaf(node)) return;    this.setConditionOperator(node.ref, operator);
  }

  protected setCanvasNodeValue(id: number, value: string) {
    const node = this.findCanvasNode(id, 'condition');
    if (!node || !this.canvasLeaf(node)) return;    this.setConditionValue(node.ref, value);
  }

  protected setCanvasNodeAction(id: number, actionKey: string) {
    const node = this.findCanvasNode(id, 'output');
    const def = getAction(actionKey);
    if (!node || !def) return;
    const base = this.baseRule();
    const existing = base.actions[node.ref];
    if (!existing || existing.action === actionKey) return;    this.updateRule({
      ...base,
      actions: base.actions.map((output, i) =>
        i === node.ref ? { action: def.key, params: defaultParamFor(def) } : output
      ),
    });
  }

  protected setCanvasNodeParam(id: number, value: string) {
    const node = this.findCanvasNode(id, 'output');
    if (!node || !this.baseRule().actions[node.ref]) return;    this.setActionParam(node.ref, value);
  }

  /* Text composer, structured builder, and diagram share one finite motion channel. */
  private pulseSpiral() {
    if (this.spinTimer !== null) clearTimeout(this.spinTimer);
    this.spinTimer = setTimeout(() => {
      this.spinPulse.update((pulse) => pulse + 1);
      this.spinTimer = null;
    }, 180);
  }

  protected onInput(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    this.cancelTypeOut();
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
    // Phase 1.6: rough-match the description on every keystroke so the
    // builder columns light up as the parser recognizes pieces. Display-only
    // until committed by Enter or a builder click.
    this.refreshLiveParse(textarea.value);
  }

  /**
   * Parser options for the composer. Phase 1.9.5: authoring is permissive — a
   * mentioned value that isn't in the vocabulary still lands in the rule (so the
   * field works), and is reported in `unbacked` so the UI flags it as "not
   * backed by real data" instead of blocking on an unresolved slot.
   */
  private parseOpts(extra?: ParseOptions): ParseOptions {
    return { allowUnbackedValues: true, ...extra };
  }

  private refreshLiveParse(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      this.liveResult.set(null);
      return;
    }
    try {
      this.liveResult.set(parseInstruction(trimmed, this.parseOpts()));
    } catch {
      this.liveResult.set(null);
    }
  }

  protected onComposerKeydown(event: KeyboardEvent) {
    // Predictive accept: Tab always, → only when the caret sits at the very end
    // (so → still moves the cursor when editing mid-text). Runs before Enter.
    if (this.ghostRaw() && !event.isComposing) {
      const target = event.target as HTMLTextAreaElement;
      const atEnd =
        target.selectionStart === target.value.length &&
        target.selectionStart === target.selectionEnd;
      if (event.key === 'Tab' || (event.key === 'ArrowRight' && atEnd)) {
        event.preventDefault();
        this.acceptGhost();
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.build();
    }
  }

  /**
   * Accept the current ghost-text prediction: append the predicted continuation
   * to the composer text and re-enter the live "typing" state exactly as if the
   * operator had typed it (same signal resets as onInput), so the builder's
   * rough-match preview keeps up and a fresh prediction can chain off the end.
   */
  protected acceptGhost() {
    const completion = this.ghostRaw();
    if (!completion) return;
    const next = this.text() + completion;
    this.cancelTypeOut();
    this.buildGeneration++;
    this.text.set(next);
    this.result.set(null);
    this.parsedDescription.set(null);
    this.error.set(null);
    this.clearRevisionFeedback();
    this.typingPulse.update((pulse) => pulse + 1);
    this.phase.set('idle');
    this.refreshLiveParse(next);
    const el = this.composerInput?.nativeElement;
    if (el) {
      el.value = next;
      this.syncComposerHeight();
      requestAnimationFrame(() => {
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
      });
    }
  }

  protected build(event?: Event) {
    event?.preventDefault();
    const description = this.text().trim();
    if (!description) return;
    this.cancelTypeOut();
    this.liveResult.set(null);
    const generation = ++this.buildGeneration;
    this.error.set(null);
    this.clearRevisionFeedback();
    this.result.set(null);
    this.parsedDescription.set(null);
    this.phase.set('submitted');
    this.pulseSpiral();

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
    // Real-AI engine, falling back to the deterministic parser in mock mode or
    // on model failure (DraftEngineService.draft never errors to the subscriber).
    // The 'parsing' phase stays visible for the round-trip; the generation guard
    // discards a stale response if a newer build started meanwhile.
    this.engine.draft(description, this.parseOpts()).subscribe((result) => {
      if (generation !== this.buildGeneration) return;
      this.result.set(result);
      this.parsedDescription.set(result.rule ? description : null);
      this.phase.set(result.rule ? 'idle' : 'parser-error');
    });
  }

  /* ---- Structured visual builder mutations (Phase 1.5 / 1.6) ----
   * Every mutation is immutable and funnels through updateRule, so the
   * interpretation, gap gate, simulation, and save flow all react exactly as
   * they do to a parsed description. */

  private updateRule(rule: WorkflowRule) {
    // A visual edit supersedes any in-flight parse AND the last parse's
    // sidecar: stale unresolved/uncovered/ambiguity entries describe text
    // that is replaced by the canonical composition below, and their
    // index-addressed clarifications would patch the wrong node.
    this.buildGeneration++;
    this.liveResult.set(null);
    this.result.set({ rule, notes: [], unresolved: [], uncovered: [], ambiguities: [] });
    // Phase 1.6 bi-directional sync: compose the canonical description for the
    // committed rule and type it into the cursor. The composed text is what
    // save() persists as name/description, so the record always describes the
    // rule it carries.
    const composed = composeRuleText(rule);
    this.parsedDescription.set(composed);
    this.typeOut(composed);
    this.pulseSpiral();
    this.phase.set('idle');
    this.error.set(null);
    this.clearRevisionFeedback();
  }

  /** Working rule: committed, else the live rough match a click adopts, else
   *  a triggerless shell the validator keeps gated until an event is picked. */
  private baseRule(): WorkflowRule {
    return this.builderRule() ?? { ...emptyRule(), triggers: [] };
  }

  protected selectTrigger(eventKey: string) {
    const base = this.baseRule();
    const already = base.triggers.length === 1 && base.triggers[0].event === eventKey;
    // Re-clicking the sole selected trigger is a no-op on a committed rule
    // (never strips a parsed trigger scope) and a confirm on a provisional one.
    if (already && this.result()) return;
    this.updateRule(already ? base : { ...base, triggers: [{ event: eventKey }] });
  }

  protected addCondition(fieldKey: string) {
    const field = FIELDS[fieldKey];
    if (!field) return;
    const base = this.baseRule();
    const leaf: ConditionLeaf = {
      field: field.key,
      operator: OPERATORS[field.kind][0].value,
      value: defaultValueFor(field),
    };
    this.updateRule({
      ...base,
      conditions: { ...base.conditions, children: [...base.conditions.children, leaf] },
    });
  }

  protected removeCondition(index: number) {
    const base = this.baseRule();
    this.updateRule({
      ...base,
      conditions: {
        ...base.conditions,
        children: base.conditions.children.filter((_, i) => i !== index),
      },
    });
  }

  protected setConditionOperator(index: number, operator: string) {
    const base = this.baseRule();
    this.updateRule({
      ...base,
      conditions: {
        ...base.conditions,
        children: base.conditions.children.map((node, i) =>
          i === index && !isGroup(node) ? { ...node, operator } : node
        ),
      },
    });
  }

  protected setConditionValue(index: number, value: string) {
    const base = this.baseRule();
    this.updateRule({
      ...base,
      conditions: {
        ...base.conditions,
        children: base.conditions.children.map((node, i) =>
          i === index && !isGroup(node)
            ? { ...node, value: this.keepRefIfSameLabel(node.value, value) }
            : node
        ),
      },
    });
  }

  /** Keep an ID-bound ScopeRef when the user re-picks its own display label —
   *  touching a control must not silently downgrade an instance ref to text. */
  private keepRefIfSameLabel(prev: ScopeValue | undefined, next: string): ScopeValue {
    return prev != null && typeof prev !== 'string' && scopeLabel(prev) === next ? prev : next;
  }

  protected setLogic(logic: string) {
    if (logic !== 'AND' && logic !== 'OR') return;
    const base = this.baseRule();
    this.updateRule({ ...base, conditions: { ...base.conditions, logic } });
  }

  protected addAction(actionKey: string) {
    const def = getAction(actionKey);
    if (!def) return;
    const base = this.baseRule();
    this.updateRule({
      ...base,
      actions: [...base.actions, { action: def.key, params: defaultParamFor(def) }],
    });
  }

  protected removeAction(index: number) {
    const base = this.baseRule();
    this.updateRule({ ...base, actions: base.actions.filter((_, i) => i !== index) });
  }

  protected setActionParam(index: number, value: string) {
    const base = this.baseRule();
    this.updateRule({
      ...base,
      actions: base.actions.map((output, i) => {
        if (i !== index) return output;
        const def = getAction(output.action);
        const key = def ? paramKeyFor(def.key) : 'value';
        return {
          ...output,
          params: { ...output.params, [key]: this.keepRefIfSameLabel(output.params[key], value) },
        };
      }),
    });
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
      this.engine.draft(this.text().trim(), this.parseOpts({ forceEvent: permitted })).subscribe((reparsed) => {
        this.result.set(reparsed);
        this.pulseSpiral();
      });
    } else {
      this.result.set(applyClarification(result, question.id, value));
      this.pulseSpiral();
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
    this.pulseSpiral();
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
      this.pulseSpiral();
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
    const name = this.nameForDescription(description);
    const write = { name, description, ruleJson: applyOrgPolicy(validated.rule) };

    if (this.session.mustProposeWorkflow()) {
      this.service.createProposal(write).subscribe({
        next: () =>
          void this.router.navigate(['/workflows/proposals'], {
            state: { notice: 'Workflow proposed! Submitted to review queue for Admin approval.' },
          }),
        error: (error: Error) => {
          this.saving.set(false);
          this.error.set(error.message);
          this.phase.set('network-error');
        },
      });
    } else {
      this.service.create(write).subscribe({
        next: (record) => void this.router.navigate(['/workflows', record.id]),
        error: (error: Error) => {
          this.saving.set(false);
          this.error.set(error.message);
          this.phase.set('network-error');
        },
      });
    }
  }

  private nameForDescription(description: string): string {
    return description
      ? description.length > 60
        ? `${description.slice(0, 57)}…`
        : description
      : 'Untitled workflow';
  }

  protected back() {
    void this.router.navigate(['/workflows']);
  }
}
