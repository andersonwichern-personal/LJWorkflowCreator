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
import { composeRuleText } from '../../../core/ruleText';
import {
  ACTIONS,
  ActionDef,
  CondLogic,
  ConditionLeaf,
  EVENTS,
  EventDef,
  FIELDS,
  OPERATORS,
  ScopeValue,
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
import { WorkflowsService } from '../data/workflows.service';
import { SweetSpiral } from '../ui/sweet-spiral';
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

/** Cubic bezier between two node centers (45px = node radius offset, spec §8). */
function bezierPath(ax: number, ay: number, bx: number, by: number): string {
  const dx = Math.abs(bx - ax) * 0.4;
  return `M ${ax + 45} ${ay} C ${ax + 45 + dx} ${ay}, ${bx - 45 - dx} ${by}, ${bx - 45} ${by}`;
}

/** Default trigger for a palette-placed event node — first entry of the first picker group. */
const DEFAULT_CANVAS_EVENT = EVENT_PICKER_GROUPS[0]?.entries[0]?.key ?? EVENTS[0].key;

@Component({
  selector: 'wf-workflow-composer-page',
  imports: [...LJ_PRIMITIVES, SweetSpiral],
  template: `
    <lj-page>
      <div class="composer-shell">
        <button type="button" class="back" (click)="back()">
          <span aria-hidden="true">←</span> Workflows
        </button>

        <section class="hero" aria-labelledby="composer-title">
          <div class="hero-top">
            <div class="spiral-wrap">
              <wf-sweet-spiral [state]="spiralState()" [typingPulse]="typingPulse()" />
            </div>

            <div class="invitation">
              @if (!reviewing()) {
                <p class="eyebrow">A clearer way to work</p>
                <h1 id="composer-title">Let’s make your operations a little sweeter.</h1>
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
              placeholder="Create a workflow."
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

          @if (focused() || text()) {
            <p class="guidance" id="composer-guidance">
              Enter to continue <span aria-hidden="true">·</span> Shift + Enter for a new line
            </p>
          }
          <p class="sr-only" aria-live="polite" aria-atomic="true">{{ liveStatus() }}</p>

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
                      <span class="option-emoji" aria-hidden="true">{{ entry.emoji }}</span>
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
                          >✕</button>
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
                      <span class="option-emoji" aria-hidden="true">{{ entry.emoji }}</span>
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
                        <h3><span aria-hidden="true">{{ card.emoji }}</span> {{ card.label }}</h3>
                        <button
                          type="button"
                          class="remove"
                          (click)="removeAction(card.index)"
                          [attr.aria-label]="'Remove action: ' + card.label"
                        >✕</button>
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
              <h2 class="canvas-title">Workflow diagram</h2>
              <div class="canvas-toolbar">
                <button
                  type="button"
                  class="canvas-btn"
                  [class.active]="connectMode()"
                  (click)="toggleConnectMode()"
                >🔗 {{ connectMode() ? 'Connecting…' : 'Connect mode' }}</button>
                <button type="button" class="canvas-btn ghost" (click)="clearCanvas()">Clear board</button>
              </div>
            </div>

            <div class="canvas-body">
              <aside class="canvas-palette" aria-label="Node palette">
                <p class="palette-heading">Drag onto canvas</p>
                <div
                  class="palette-node"
                  draggable="true"
                  (dragstart)="paletteDragStart($event, 'event')"
                  (click)="paletteClick('event')"
                >
                  <div class="pnode-shape event-shape">▲</div>
                  <span>Event<br />(circle)</span>
                </div>
                <div
                  class="palette-node"
                  draggable="true"
                  (dragstart)="paletteDragStart($event, 'condition')"
                  (click)="paletteClick('condition')"
                >
                  <div class="pnode-shape cond-shape"><span>◆</span></div>
                  <span>Condition<br />(diamond)</span>
                </div>
                <div
                  class="palette-node"
                  draggable="true"
                  (dragstart)="paletteDragStart($event, 'output')"
                  (click)="paletteClick('output')"
                >
                  <div class="pnode-shape output-shape">●</div>
                  <span>Output<br />(circle)</span>
                </div>
                <p class="palette-hint">
                  Drag a shape onto the board, or click to place at center. Drag the purple port dot to connect nodes.
                </p>
              </aside>

              <div
                class="canvas-stage"
                #canvasStage
                (dragover)="$event.preventDefault()"
                (drop)="canvasDrop($event)"
              >
                <svg class="canvas-svg" aria-hidden="true">
                  <defs>
                    <marker id="wf-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
                      <path d="M0,0 L8,3 L0,6 Z" fill="#6941c6" />
                    </marker>
                  </defs>
                  @for (edge of edgePaths(); track edge.key) {
                    <path [attr.d]="edge.d" stroke="#6941c6" stroke-width="2" fill="none" marker-end="url(#wf-arrow)" />
                  }
                  @if (tempEdgePath(); as d) {
                    <path [attr.d]="d" stroke="#6941c6" stroke-width="2" fill="none" stroke-dasharray="6 4" />
                  }
                </svg>
                @if (!canvasNodes().length) {
                  <p class="canvas-empty">
                    Drag an Event, Condition or Output here to start — or describe your workflow above and the diagram will build itself.
                  </p>
                }
                @for (node of canvasNodes(); track node.id) {
                  <div
                    class="canvas-node"
                    [class.cn-event]="node.type === 'event'"
                    [class.cn-condition]="node.type === 'condition'"
                    [class.cn-output]="node.type === 'output'"
                    [class.cn-selected]="selectedCanvasNodeId() === node.id"
                    [class.cn-connect-from]="connectFrom() === node.id"
                    [style.left.px]="node.x"
                    [style.top.px]="node.y"
                    [attr.data-node-id]="node.id"
                    (mousedown)="nodeMouseDown($event, node)"
                  >
                    <div class="cn-shape">
                      @if (node.type === 'condition') {
                        <span>{{ canvasNodeLabel(node) }}</span>
                      } @else {
                        {{ canvasNodeLabel(node) }}
                      }
                    </div>
                    <div class="cn-caption">{{ canvasNodeCaption(node) }}</div>
                    <div class="cn-port" title="Drag to connect" (mousedown)="portMouseDown($event, node)"></div>
                  </div>
                }
              </div>

              <aside class="canvas-inspector" aria-label="Node inspector">
                @if (selectedCanvasNode(); as node) {
                  <p class="inspector-title">{{ node.type }} node</p>
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
                              {{ entry.emoji }} {{ entry.label }}
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
                              {{ entry.emoji }} {{ entry.label }}
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
                  <button class="insp-delete" type="button" (click)="deleteCanvasNode(node.id)">Delete node</button>
                  <button class="insp-save" type="button" (click)="commitCanvasToRule()">Save workflow</button>
                } @else {
                  <p class="insp-empty">Select a node to configure it.</p>
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
                  @if (gapNotes().length) {
                    <ul class="gap-notes">
                      @for (note of gapNotes(); track note) {
                        <li>{{ note }}</li>
                      }
                    </ul>
                  }
                  @if (visibleQuestions().length && gaps().length > visibleQuestions().length) {
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
    .hero { width: min(100%, 1160px); margin: 0 auto; padding: var(--space-2) 0 var(--space-12); }
    .hero-top { display: flex; align-items: center; gap: var(--space-6); }
    .spiral-wrap { width: 120px; height: 120px; flex: none; }
    .invitation { min-width: 0; }
    h1 {
      margin: var(--space-2) 0 0; font-size: clamp(1.55rem, 2.6vw, 2rem);
      line-height: 1.08; letter-spacing: -.045em; font-weight: 760;
    }
    .composer { position: relative; display: flex; align-items: flex-end; margin-top: var(--space-6); }
    textarea {
      width: 100%; min-height: 3.6rem; max-height: 14rem; padding: .55rem 3.5rem .7rem 0;
      border: 0; outline: 0; resize: none; overflow: hidden; color: var(--text); background: transparent;
      font-size: clamp(1.2rem, 2.2vw, 1.75rem); line-height: 1.42; caret-color: var(--brand);
    }
    textarea::placeholder { color: var(--text-soft); opacity: 1; }
    .send {
      position: absolute; right: 0; bottom: .55rem; width: 2.75rem; height: 2.75rem;
      border: 0; border-radius: 50%; background: var(--brand); color: var(--sweet-ink);
      font-weight: 900; cursor: pointer; transition: transform var(--motion-medium) var(--ease-settle);
    }
    .send:hover { transform: translateY(-2px) rotate(3deg); }
    .guidance { margin: var(--space-3) 0 0; color: var(--text-soft); font-size: var(--text-xs); }

    /* ---- Structured visual builder (Phase 1.5) ---- */
    .visual-builder {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--space-4);
      margin-top: var(--space-8);
      align-items: start;
    }
    .builder-column {
      display: flex; flex-direction: column; gap: var(--space-3);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--space-4);
      min-height: 480px;
      box-shadow: var(--shadow-soft);
      transition: border-color var(--motion-medium) var(--ease-standard);
    }
    .builder-column:hover { border-color: var(--border-strong); }
    .column-header {
      display: flex; align-items: center; gap: var(--space-2); margin: 0;
      font-size: var(--text-lg); letter-spacing: -.02em; font-weight: 780;
    }
    .step {
      width: 1.5rem; height: 1.5rem; display: grid; place-items: center; flex: none;
      border-radius: 50%; background: var(--brand); color: var(--sweet-ink);
      font-size: var(--text-xs); font-weight: 800;
    }
    .provisional-hint {
      grid-column: 1 / -1; margin: 0; padding: var(--space-2) var(--space-3);
      border: 1px dashed var(--border-strong); border-radius: var(--radius-md);
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
      width: 100%; min-height: 40px; padding-inline: .85rem;
      border-color: var(--border); border-radius: var(--radius-pill); background: var(--surface-inset);
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
    .option.selected { background: var(--brand); border-color: var(--brand); color: var(--sweet-ink); }
    .option.selected .unconfirmed { color: inherit; }
    .option-label { flex: 1; min-width: 0; }
    .unconfirmed {
      flex: none; color: var(--warn-text); font-size: .6rem; font-weight: 800;
      letter-spacing: .06em; text-transform: uppercase;
    }
    .zero { margin: 0; color: var(--text-dim); font-size: var(--text-sm); }
    .pill-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .pill {
      min-height: 34px; padding: .3rem .75rem; border: 1px solid var(--border-strong);
      border-radius: var(--radius-pill); background: var(--surface-inset); color: var(--text);
      font-size: var(--text-xs); font-weight: 750; cursor: pointer;
    }
    .pill:hover { border-color: var(--brand); color: var(--brand-text); }
    .cards { display: flex; flex-direction: column; gap: var(--space-2); }
    .card {
      border: 1px solid var(--border); border-radius: var(--radius-md);
      background: var(--surface-inset); padding: var(--space-3);
    }
    .card-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
    .card-head h3 { margin: 0; font-size: var(--text-sm); font-weight: 760; }
    .remove { flex: none; padding: .15rem .35rem; border: 0; background: transparent; color: var(--text-soft); cursor: pointer; }
    .remove:hover { color: var(--danger); }
    .card-controls { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); margin-top: var(--space-2); }
    .card-controls select, .card-controls input { width: 100%; min-width: 0; }
    .card-controls select:only-child, .card-controls input:only-child { grid-column: 1 / -1; }
    .logic {
      align-self: center; min-height: 34px; border-radius: var(--radius-pill);
      font-size: var(--text-xs); font-weight: 800; cursor: pointer;
    }
    .group-note { margin: var(--space-2) 0 0; color: var(--text-dim); font-size: var(--text-xs); }

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
      .review-section { grid-template-columns: 7rem 1fr; }
    }
    @media (max-width: 620px) {
      .composer-shell { padding-top: var(--space-3); }
      .hero-top { gap: var(--space-4); }
      .spiral-wrap { width: 88px; height: 88px; }
      h1 { font-size: clamp(1.35rem, 6vw, 1.75rem); }
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
export class WorkflowComposerPage implements AfterViewInit, OnDestroy {
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

  ngAfterViewInit() {
    requestAnimationFrame(() => this.composerInput?.nativeElement.focus());
  }

  ngOnDestroy() {
    this.cancelTypeOut();
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

  /* ---- Workflow canvas diagram (Phase 1.7) ----
   * Spatial view of the same rule signal. Rule → canvas: an effect rebuilds a
   * left-to-right auto-layout whenever the rule changes from the parser, the
   * live rough match, or the 3-column builder. Canvas → rule: every canvas
   * mutation is a surgical immutable patch on the rule piece a node points at
   * (node.ref = index into triggers / conditions.children / actions),
   * funneled through updateRule(); the canvasSourced guard keeps the effect
   * from discarding manual node positions in response. Edges render
   * reactively from signals — no imperative SVG writes. Nested condition
   * groups stay in the rule untouched; the canvas shows root-level leaves. */

  @ViewChild('canvasStage') private canvasStage?: ElementRef<HTMLDivElement>;

  protected readonly canvasNodes = signal<CanvasNode[]>([]);
  protected readonly canvasEdges = signal<CanvasEdge[]>([]);
  protected readonly selectedCanvasNodeId = signal<number | null>(null);
  protected readonly connectMode = signal(false);
  protected readonly connectFrom = signal<number | null>(null);
  protected readonly tempEdge = signal<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null
  );
  private canvasSeq = 0;
  private canvasSourced = false;

  protected readonly selectedCanvasNode = computed(
    () => this.canvasNodes().find((node) => node.id === this.selectedCanvasNodeId()) ?? null
  );

  protected readonly edgePaths = computed(() => {
    const byId = new Map(this.canvasNodes().map((node) => [node.id, node]));
    const paths: { key: string; d: string }[] = [];
    for (const edge of this.canvasEdges()) {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (a && b) paths.push({ key: `${edge.from}-${edge.to}`, d: bezierPath(a.x, a.y, b.x, b.y) });
    }
    return paths;
  });

  protected readonly tempEdgePath = computed(() => {
    const edge = this.tempEdge();
    return edge ? bezierPath(edge.x1, edge.y1, edge.x2, edge.y2) : null;
  });

  private readonly canvasSync = effect(() => {
    // Read the dependency BEFORE the guard: an early return that never reads
    // builderRule() would untrack it and the effect would never fire again.
    const rule = this.builderRule();
    if (this.canvasSourced) {
      this.canvasSourced = false;
      return;
    }
    if (!rule) {
      this.canvasNodes.set([]);
      this.canvasEdges.set([]);
      this.selectedCanvasNodeId.set(null);
      this.connectFrom.set(null);
      return;
    }
    this.rebuildCanvasFromRule(rule);
  });

  private rebuildCanvasFromRule(rule: WorkflowRule) {
    const vy = (i: number, count: number) =>
      Math.max(90, Math.min(430, 250 + (i - (count - 1) / 2) * 130));
    const nodes: CanvasNode[] = [];
    rule.triggers.forEach((_, i) =>
      nodes.push({ id: ++this.canvasSeq, type: 'event', x: 160, y: vy(i, rule.triggers.length), ref: i })
    );
    const leafRefs = rule.conditions.children
      .map((child, i) => (isGroup(child) ? -1 : i))
      .filter((i) => i >= 0);
    leafRefs.forEach((childIndex, i) =>
      nodes.push({ id: ++this.canvasSeq, type: 'condition', x: 460, y: vy(i, leafRefs.length), ref: childIndex })
    );
    rule.actions.forEach((_, i) =>
      nodes.push({ id: ++this.canvasSeq, type: 'output', x: 760, y: vy(i, rule.actions.length), ref: i })
    );
    const events = nodes.filter((node) => node.type === 'event');
    const conds = nodes.filter((node) => node.type === 'condition');
    const outputs = nodes.filter((node) => node.type === 'output');
    const edges: CanvasEdge[] = [];
    if (conds.length) {
      for (const event of events) edges.push({ from: event.id, to: conds[0].id });
      for (let i = 0; i < conds.length - 1; i++) edges.push({ from: conds[i].id, to: conds[i + 1].id });
      for (const output of outputs) edges.push({ from: conds[conds.length - 1].id, to: output.id });
    } else {
      for (const event of events) for (const output of outputs) edges.push({ from: event.id, to: output.id });
    }
    this.canvasNodes.set(nodes);
    this.canvasEdges.set(edges);
    if (!nodes.some((node) => node.id === this.selectedCanvasNodeId())) {
      this.selectedCanvasNodeId.set(null);
    }
    this.connectFrom.set(null);
  }

  /* ---- Canvas: palette + stage interactions ---- */

  protected paletteDragStart(e: DragEvent, type: CanvasNode['type']) {
    e.dataTransfer?.setData('nodeType', type);
  }

  protected paletteClick(type: CanvasNode['type']) {
    const center = this.canvasStageCenter();
    this.addCanvasNode(type, center.x, center.y);
  }

  protected canvasDrop(e: DragEvent) {
    e.preventDefault();
    const type = e.dataTransfer?.getData('nodeType') as CanvasNode['type'] | '';
    if (type !== 'event' && type !== 'condition' && type !== 'output') return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.addCanvasNode(type, e.clientX - rect.left, e.clientY - rect.top);
  }

  private canvasStageCenter(): { x: number; y: number } {
    const el = this.canvasStage?.nativeElement;
    return el ? { x: el.clientWidth / 2, y: el.clientHeight / 2 } : { x: 460, y: 250 };
  }

  protected nodeMouseDown(e: MouseEvent, node: CanvasNode) {
    if ((e.target as HTMLElement).classList.contains('cn-port')) return;
    if (this.connectMode()) {
      this.handleConnectClick(node.id);
      return;
    }
    e.preventDefault();
    this.selectedCanvasNodeId.set(node.id);
    const stage = this.canvasStage?.nativeElement;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const offsetX = e.clientX - rect.left - node.x;
    const offsetY = e.clientY - rect.top - node.y;
    const move = (ev: MouseEvent) => {
      const x = Math.max(20, Math.min(rect.width - 20, ev.clientX - rect.left - offsetX));
      const y = Math.max(20, Math.min(rect.height - 20, ev.clientY - rect.top - offsetY));
      this.canvasNodes.update((nodes) => nodes.map((n) => (n.id === node.id ? { ...n, x, y } : n)));
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  protected portMouseDown(e: MouseEvent, fromNode: CanvasNode) {
    e.stopPropagation();
    e.preventDefault();
    const stage = this.canvasStage?.nativeElement;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      this.tempEdge.set({
        x1: fromNode.x,
        y1: fromNode.y,
        x2: ev.clientX - rect.left,
        y2: ev.clientY - rect.top,
      });
    };
    const up = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      this.tempEdge.set(null);
      const target = (ev.target as HTMLElement | null)?.closest?.('[data-node-id]');
      const targetId = target ? Number(target.getAttribute('data-node-id')) : NaN;
      if (Number.isFinite(targetId) && targetId !== fromNode.id) {
        this.addCanvasEdge(fromNode.id, targetId);
      }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  protected toggleConnectMode() {
    this.connectMode.update((on) => !on);
    this.connectFrom.set(null);
  }

  protected handleConnectClick(id: number) {
    const from = this.connectFrom();
    if (from === null) {
      this.connectFrom.set(id);
    } else {
      if (from !== id) this.addCanvasEdge(from, id);
      this.connectFrom.set(null);
    }
  }

  protected clearCanvas() {
    this.canvasNodes.set([]);
    this.canvasEdges.set([]);
    this.selectedCanvasNodeId.set(null);
    this.connectFrom.set(null);
    this.tempEdge.set(null);
  }

  private addCanvasEdge(from: number, to: number) {
    this.canvasEdges.update((edges) =>
      edges.some((edge) => edge.from === from && edge.to === to) ? edges : [...edges, { from, to }]
    );
  }

  /* ---- Canvas: add / delete nodes (each maps to a rule piece) ---- */

  private addCanvasNode(type: CanvasNode['type'], x: number, y: number) {
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
    const id = ++this.canvasSeq;
    this.canvasNodes.update((nodes) => [...nodes, { id, type, x, y, ref }]);
    this.selectedCanvasNodeId.set(id);
    this.canvasSourced = true;
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
    this.canvasNodes.update((nodes) =>
      nodes
        .filter((n) => n.id !== id)
        .map((n) => (n.type === node.type && n.ref > node.ref ? { ...n, ref: n.ref - 1 } : n))
    );
    this.canvasEdges.update((edges) => edges.filter((edge) => edge.from !== id && edge.to !== id));
    if (this.selectedCanvasNodeId() === id) this.selectedCanvasNodeId.set(null);
    if (rule) {
      this.canvasSourced = true;
      this.updateRule(rule);
    }
  }

  /** "Save workflow": re-commit the working rule (composes the description,
   *  re-runs the gap gate + review flow; commits a provisional rough match). */
  protected commitCanvasToRule() {
    const rule = this.builderRule();
    if (!rule) return;
    this.canvasSourced = true;
    this.updateRule(rule);
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
    if (!base.triggers[node.ref] || base.triggers[node.ref].event === eventKey) return;
    this.canvasSourced = true;
    this.updateRule({
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
    const base = this.baseRule();
    this.canvasSourced = true;
    this.updateRule({
      ...base,
      conditions: {
        ...base.conditions,
        children: base.conditions.children.map((child, i) => (i === node.ref ? replacement : child)),
      },
    });
  }

  protected setCanvasNodeOperator(id: number, operator: string) {
    const node = this.findCanvasNode(id, 'condition');
    if (!node || !this.canvasLeaf(node)) return;
    this.canvasSourced = true;
    this.setConditionOperator(node.ref, operator);
  }

  protected setCanvasNodeValue(id: number, value: string) {
    const node = this.findCanvasNode(id, 'condition');
    if (!node || !this.canvasLeaf(node)) return;
    this.canvasSourced = true;
    this.setConditionValue(node.ref, value);
  }

  protected setCanvasNodeAction(id: number, actionKey: string) {
    const node = this.findCanvasNode(id, 'output');
    const def = getAction(actionKey);
    if (!node || !def) return;
    const base = this.baseRule();
    const existing = base.actions[node.ref];
    if (!existing || existing.action === actionKey) return;
    this.canvasSourced = true;
    this.updateRule({
      ...base,
      actions: base.actions.map((output, i) =>
        i === node.ref ? { action: def.key, params: defaultParamFor(def) } : output
      ),
    });
  }

  protected setCanvasNodeParam(id: number, value: string) {
    const node = this.findCanvasNode(id, 'output');
    if (!node || !this.baseRule().actions[node.ref]) return;
    this.canvasSourced = true;
    this.setActionParam(node.ref, value);
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

  private refreshLiveParse(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      this.liveResult.set(null);
      return;
    }
    try {
      this.liveResult.set(parseInstruction(trimmed));
    } catch {
      this.liveResult.set(null);
    }
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
    this.cancelTypeOut();
    this.liveResult.set(null);
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
    const name = description
      ? description.length > 60
        ? `${description.slice(0, 57)}…`
        : description
      : 'Untitled workflow';
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
