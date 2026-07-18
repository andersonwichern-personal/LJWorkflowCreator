# Developer Spec: Workflow Canvas Diagram (Phase 1.7)
**File:** `docs/2026-07-18_workflow-canvas-diagram_v1.md`
**Target Component:** `src/app/features/workflows/pages/workflow-composer.page.ts`

---

## 1. Overview

Add a **visual drag-and-drop workflow canvas** section to the composer page. It sits **below the 3-column structured builder** (`.visual-builder`) and **above the `@if (reviewing())` review flow**. This section gives users a spatial, diagram-style view of the workflow they are building — mirroring the whiteboard canvas from `Workflow Creator Proposal Templates/2026-07-09_workflow-creator-proposal-2-whiteboard.html` — but rebuilt as a native Angular component using the Sweet design system, fully synced with the existing `result()` / `rule()` signal state.

The canvas is **read/write**: editing via the canvas updates the rule signal just like the 3-column builder does. And when the AI parser fires or the 3-column builder changes the rule, the canvas re-renders automatically from those signals (reactive, not imperative).

---

## 2. Placement in the Template

Insert the new `<section class="canvas-diagram">` block directly after the closing `</section>` of the `.visual-builder` section and before the error notice block. Approximate location in the current template:

```
...
        </section>  <!-- /.visual-builder -->

        <!-- ★ INSERT CANVAS DIAGRAM HERE ★ -->
        <section class="canvas-diagram" aria-label="Workflow diagram canvas">
          ...
        </section>

        @if (error()) {
          <section class="notice error" role="alert">
```

---

## 3. Component Architecture

Build this as **inline template markup within the existing `WorkflowComposerPage`** component (do not create a new standalone component). Use Angular signals, computed properties, and a host-level `ElementRef` for the SVG edge rendering. Keep it self-contained — no third-party canvas/charting libraries.

### 3a. Data Model — `CanvasNode`

Add the following interface and signal to the component class:

```typescript
interface CanvasNode {
  id: number;
  type: 'event' | 'condition' | 'output';
  x: number;
  y: number;
}

interface CanvasEdge {
  from: number;
  to: number;
}
```

- `canvasNodes = signal<CanvasNode[]>([])` — mutable node layout state
- `canvasEdges = signal<CanvasEdge[]>([])` — mutable edge connections
- `canvasSeq = 0` — monotonic node ID counter (private field, not a signal)
- `selectedCanvasNodeId = signal<number | null>(null)` — selected node for the inspector panel
- `connectMode = signal(false)` — toggles port-drag vs. click-connect mode
- `connectFrom = signal<number | null>(null)` — first node selected in click-connect

### 3b. Sync From Rule → Canvas (Auto-layout on rule changes)

Add a reactive `effect()` that watches `this.rule()` and auto-populates the canvas when the rule changes from the parser or the 3-column builder (i.e., the canvas was not the source of the change). Use a private `canvasSourced = false` guard flag:

```typescript
// When rule changes externally (parser or 3-col builder), rebuild canvas layout
effect(() => {
  if (this.canvasSourced) { this.canvasSourced = false; return; }
  const rule = this.rule();
  if (!rule) { this.canvasNodes.set([]); this.canvasEdges.set([]); return; }
  this.rebuildCanvasFromRule(rule);
});
```

`rebuildCanvasFromRule(rule: WorkflowRule)` generates a clean left-to-right auto-layout:
- One **event node** per trigger at x=160, y spaced vertically.
- One **condition node** per condition leaf at x=460 (shared horizontal center).
- One **output node** per action at x=760, y spaced vertically.
- Edges: event→first-condition, condition→last-condition (chain), last-condition→each output.
- If there are no conditions, connect event nodes directly to output nodes.

### 3c. Sync From Canvas → Rule

All canvas mutations (add, remove, update a node) must call `updateRule(rule)` (the existing private method from Phase 1.6) to push changes back to the rule signal, then set `this.canvasSourced = true` before calling it so the effect guard skips the re-render.

---

## 4. Template — The Canvas Section

```html
<section class="canvas-diagram" aria-label="Workflow diagram canvas">
  <div class="canvas-header">
    <h2 class="canvas-title">Workflow diagram</h2>
    <div class="canvas-toolbar">
      <button class="canvas-btn"
              [class.active]="connectMode()"
              (click)="toggleConnectMode()"
              type="button">
        🔗 {{ connectMode() ? 'Connecting…' : 'Connect mode' }}
      </button>
      <button class="canvas-btn ghost"
              (click)="clearCanvas()"
              type="button">Clear board</button>
    </div>
  </div>

  <div class="canvas-body">
    <!-- Left palette -->
    <aside class="canvas-palette" aria-label="Node palette">
      <p class="palette-heading">Drag onto canvas</p>
      <div class="palette-node" draggable="true"
           (dragstart)="paletteDragStart($event, 'event')"
           (click)="paletteClick('event')">
        <div class="pnode-shape event-shape">▲</div>
        <span>Event<br>(circle)</span>
      </div>
      <div class="palette-node" draggable="true"
           (dragstart)="paletteDragStart($event, 'condition')"
           (click)="paletteClick('condition')">
        <div class="pnode-shape cond-shape">◆</div>
        <span>Condition<br>(diamond)</span>
      </div>
      <div class="palette-node" draggable="true"
           (dragstart)="paletteDragStart($event, 'output')"
           (click)="paletteClick('output')">
        <div class="pnode-shape output-shape">●</div>
        <span>Output<br>(circle)</span>
      </div>
      <p class="palette-hint">
        Drag a shape onto the board, or click to place at center. Drag the purple port dot to connect nodes.
      </p>
    </aside>

    <!-- SVG + node canvas -->
    <div class="canvas-stage"
         #canvasStage
         (dragover)="$event.preventDefault()"
         (drop)="canvasDrop($event)">
      <svg class="canvas-svg" #canvasSvg aria-hidden="true">
        <!-- edges rendered by drawEdges() into this svg -->
      </svg>
      @if (!canvasNodes().length) {
        <p class="canvas-empty">Drag an Event, Condition or Output here to start — or describe your workflow above and the diagram will build itself.</p>
      }
      @for (node of canvasNodes(); track node.id) {
        <div class="canvas-node"
             [class]="'cn-' + node.type"
             [class.cn-selected]="selectedCanvasNodeId() === node.id"
             [style.left.px]="node.x"
             [style.top.px]="node.y"
             [attr.data-node-id]="node.id"
             (mousedown)="nodeMouseDown($event, node)">
          <div class="cn-shape">
            @if (node.type === 'condition') {
              <span>{{ canvasNodeLabel(node) }}</span>
            } @else {
              {{ canvasNodeLabel(node) }}
            }
          </div>
          <div class="cn-caption">{{ canvasNodeCaption(node) }}</div>
          <div class="cn-port"
               title="Drag to connect"
               (mousedown)="portMouseDown($event, node)"></div>
        </div>
      }
    </div>

    <!-- Right inspector panel -->
    <aside class="canvas-inspector" aria-label="Node inspector">
      @if (selectedCanvasNode(); as node) {
        <p class="inspector-title">{{ node.type | titlecase }} node</p>
        <!-- Event inspector -->
        @if (node.type === 'event') {
          <label class="insp-label">Event</label>
          <select class="insp-select" (change)="setCanvasNodeEvent(node.id, $any($event.target).value)">
            @for (group of eventGroups(); track group.label) {
              <optgroup [label]="group.label">
                @for (entry of group.entries; track entry.key) {
                  <option [value]="entry.key" [selected]="canvasNodeEventKey(node) === entry.key">
                    {{ entry.icon }} {{ entry.label }}
                  </option>
                }
              </optgroup>
            }
          </select>
        }
        <!-- Condition inspector -->
        @if (node.type === 'condition') {
          <label class="insp-label">Condition field</label>
          <select class="insp-select" (change)="setCanvasNodeField(node.id, $any($event.target).value)">
            @for (field of conditionFields(); track field.key) {
              <option [value]="field.key" [selected]="canvasNodeFieldKey(node) === field.key">
                {{ field.label }}
              </option>
            }
          </select>
          <label class="insp-label">Operator</label>
          <select class="insp-select" (change)="setCanvasNodeOperator(node.id, $any($event.target).value)">
            @for (op of canvasNodeOperators(node); track op.value) {
              <option [value]="op.value" [selected]="canvasNodeOperator(node) === op.value">
                {{ op.label }}
              </option>
            }
          </select>
          <label class="insp-label">Value</label>
          <input class="insp-input" [value]="canvasNodeValue(node)"
                 (input)="setCanvasNodeValue(node.id, $any($event.target).value)" />
        }
        <!-- Output inspector -->
        @if (node.type === 'output') {
          <label class="insp-label">Action</label>
          <select class="insp-select" (change)="setCanvasNodeAction(node.id, $any($event.target).value)">
            @for (group of actionGroups(); track group.label) {
              <optgroup [label]="group.label">
                @for (entry of group.entries; track entry.key) {
                  <option [value]="entry.key" [selected]="canvasNodeActionKey(node) === entry.key">
                    {{ entry.icon }} {{ entry.label }}
                  </option>
                }
              </optgroup>
            }
          </select>
          <!-- Render param inputs for this action (use existing actionCards() to find the card) -->
          @if (canvasNodeActionCard(node); as card) {
            @if (card.mode !== 'none') {
              <label class="insp-label">{{ card.paramLabel }}</label>
              @if (card.mode === 'select') {
                <select class="insp-select" (change)="setCanvasNodeParam(node.id, $any($event.target).value)">
                  @for (opt of card.options; track opt) {
                    <option [value]="opt" [selected]="card.value === opt">{{ opt }}</option>
                  }
                </select>
              } @else {
                <input class="insp-input" [value]="card.value ?? ''"
                       (input)="setCanvasNodeParam(node.id, $any($event.target).value)" />
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
```

---

## 5. Component Class Methods to Add

All methods below funnel through `updateRule()` (the existing Phase 1.6 helper) so the gap gate, simulation, and save flow all react identically.

```typescript
/* ---- Canvas: derived selectors ---- */
protected readonly selectedCanvasNode = computed(() =>
  this.canvasNodes().find(n => n.id === this.selectedCanvasNodeId()) ?? null
);

/* ---- Canvas: palette interactions ---- */
protected paletteDragStart(e: DragEvent, type: 'event' | 'condition' | 'output') {
  e.dataTransfer?.setData('nodeType', type);
}
protected paletteClick(type: 'event' | 'condition' | 'output') {
  this.addCanvasNode(type, this.canvasStageCenter().x, this.canvasStageCenter().y);
}
protected canvasDrop(e: DragEvent) {
  e.preventDefault();
  const type = e.dataTransfer?.getData('nodeType') as 'event' | 'condition' | 'output';
  if (!type) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  this.addCanvasNode(type, e.clientX - rect.left, e.clientY - rect.top);
}

/* ---- Canvas: node drag-to-move ---- */
protected nodeMouseDown(e: MouseEvent, node: CanvasNode) {
  if ((e.target as HTMLElement).classList.contains('cn-port')) return;
  if (this.connectMode()) { this.handleConnectClick(node.id); return; }
  const stage = this.canvasStageEl(); // ElementRef obtained via @ViewChild('canvasStage')
  const rect = stage.getBoundingClientRect();
  const ox = e.clientX - rect.left - node.x;
  const oy = e.clientY - rect.top - node.y;
  const move = (ev: MouseEvent) => {
    this.canvasNodes.update(ns =>
      ns.map(n => n.id === node.id
        ? { ...n, x: ev.clientX - rect.left - ox, y: ev.clientY - rect.top - oy }
        : n)
    );
    this.drawEdges();
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  this.selectedCanvasNodeId.set(node.id);
}

/* ---- Canvas: port drag-to-connect ---- */
protected portMouseDown(e: MouseEvent, fromNode: CanvasNode) {
  e.stopPropagation();
  // Draw a temp SVG dashed line following the cursor, then on mouseup find target node
  // (standard port-drag pattern from the proposal — keep the logic self-contained)
}

/* ---- Canvas: connect mode ---- */
protected toggleConnectMode() {
  this.connectMode.update(v => !v);
  this.connectFrom.set(null);
}
protected handleConnectClick(id: number) {
  const from = this.connectFrom();
  if (from === null) { this.connectFrom.set(id); }
  else { if (from !== id) this.addCanvasEdge(from, id); this.connectFrom.set(null); }
}
protected clearCanvas() {
  this.canvasNodes.set([]);
  this.canvasEdges.set([]);
  this.selectedCanvasNodeId.set(null);
  this.connectFrom.set(null);
  this.drawEdges();
}

/* ---- Canvas: add / delete nodes ---- */
private addCanvasNode(type: 'event' | 'condition' | 'output', x: number, y: number) {
  const id = ++this.canvasSeq;
  this.canvasNodes.update(ns => [...ns, { id, type, x, y }]);
  this.selectedCanvasNodeId.set(id);
  this.drawEdges();
}
protected deleteCanvasNode(id: number) {
  this.canvasNodes.update(ns => ns.filter(n => n.id !== id));
  this.canvasEdges.update(es => es.filter(e => e.from !== id && e.to !== id));
  if (this.selectedCanvasNodeId() === id) this.selectedCanvasNodeId.set(null);
  this.commitCanvasToRule();
  this.drawEdges();
}
private addCanvasEdge(from: number, to: number) {
  this.canvasEdges.update(es =>
    es.some(e => e.from === from && e.to === to) ? es : [...es, { from, to }]
  );
  this.drawEdges();
}

/* ---- Canvas: commit to rule (sync canvas → rule) ---- */
protected commitCanvasToRule() {
  // Reconstruct a WorkflowRule from the canvas nodes + their stored cfg
  // Map event nodes → triggers, condition nodes → conditions.children, output nodes → actions
  // Then call: this.canvasSourced = true; this.updateRule(reconstructed);
}

/* ---- Canvas: SVG edge drawing ---- */
private drawEdges() {
  // Use @ViewChild('canvasSvg') ElementRef to write SVG <path> elements
  // Use cubic bezier curves: M x1 y1 C cx1 cy1, cx2 cy2, x2 y2
  // Arrow marker identical to the proposal: purple (#6941c6 to match Sweet accent), arrowhead marker
}
```

---

## 6. Node Label & Caption Helpers

```typescript
protected canvasNodeLabel(node: CanvasNode): string {
  // For 'event': look up the event's label from eventGroups()
  // For 'condition': look up conditionFields() to find the field label
  // For 'output': look up actionGroups() to find the action label
}
protected canvasNodeCaption(node: CanvasNode): string {
  // Short subtitle shown below the shape:
  // For 'event': the event category
  // For 'condition': "operator value" (e.g. "greater than 250000")
  // For 'output': the param value (e.g. "Loan Officer")
}
```

---

## 7. CSS Styling (add to the component's `styles` array)

Use existing Sweet design tokens. Key rules:

```scss
.canvas-diagram {
  margin-top: var(--space-8);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  overflow: hidden;
}

.canvas-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
  background: var(--surface-inset);
}
.canvas-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text);
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.canvas-toolbar { display: flex; gap: var(--space-2); }
.canvas-btn {
  font-size: var(--text-xs);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  transition: background var(--motion-fast), color var(--motion-fast);
  &:hover { background: var(--surface-hover); }
  &.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  &.ghost { color: var(--text-muted); }
}

.canvas-body {
  display: grid;
  grid-template-columns: 140px 1fr 260px;
  height: 520px;
}

/* Palette */
.canvas-palette {
  border-right: 1px solid var(--border);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  background: var(--surface-inset);
}
.palette-heading {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin: 0 0 var(--space-1);
}
.palette-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  cursor: grab;
  font-size: 10px;
  text-align: center;
  color: var(--text-muted);
  background: var(--surface);
  user-select: none;
  transition: border-color var(--motion-fast), background var(--motion-fast);
  &:hover { border-color: var(--accent); background: var(--surface-hover); }
  &:active { cursor: grabbing; }
}
.pnode-shape {
  width: 40px; height: 40px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 15px; font-weight: 700;
  border-radius: 50%;
}
.event-shape { background: #2f9e6b; }   /* green */
.cond-shape {
  border-radius: 0;
  transform: rotate(45deg);
  font-size: 12px;
  background: #e0932f;                   /* amber */
  span { transform: rotate(-45deg); display: block; }
}
.output-shape { background: var(--accent); }  /* Sweet purple */
.palette-hint {
  font-size: 9.5px;
  color: var(--text-muted);
  line-height: 1.4;
  margin-top: auto;
}

/* Stage */
.canvas-stage {
  position: relative;
  overflow: hidden;
  background:
    linear-gradient(var(--border) 1px, transparent 1px) 0 0 / 22px 22px,
    linear-gradient(90deg, var(--border) 1px, transparent 1px) 0 0 / 22px 22px,
    var(--surface-inset);
}
.canvas-svg {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  pointer-events: none;
}
.canvas-empty {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  color: var(--text-muted); font-size: var(--text-sm);
  text-align: center; pointer-events: none;
  max-width: 260px; line-height: 1.5;
}

/* Nodes */
.canvas-node {
  position: absolute;
  transform: translate(-50%, -50%);
  cursor: move;
  user-select: none;
  text-align: center;
}
.cn-shape {
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 10.5px; line-height: 1.2; padding: 6px;
  box-shadow: var(--shadow-soft);
  transition: outline var(--motion-fast);
}
.cn-event .cn-shape, .cn-output .cn-shape {
  width: 90px; height: 90px; border-radius: 50%;
}
.cn-event .cn-shape { background: #2f9e6b; }
.cn-output .cn-shape { background: var(--accent); }
.cn-condition .cn-shape {
  width: 80px; height: 80px; background: #e0932f; transform: rotate(45deg);
  span { transform: rotate(-45deg); display: block; }
}
.cn-selected .cn-shape { outline: 3px solid var(--accent); outline-offset: 3px; }
.cn-caption {
  margin-top: 4px; font-size: 9.5px; color: var(--text-muted); max-width: 110px;
}
.cn-port {
  position: absolute; right: -7px; top: 50%;
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--accent); border: 2px solid var(--surface);
  transform: translateY(-50%); cursor: crosshair;
  opacity: 0; transition: opacity var(--motion-fast);
}
.canvas-node:hover .cn-port { opacity: 1; }

/* Inspector */
.canvas-inspector {
  border-left: 1px solid var(--border);
  padding: var(--space-3) var(--space-3);
  overflow-y: auto;
  background: var(--surface-inset);
  display: flex; flex-direction: column; gap: var(--space-2);
}
.inspector-title {
  font-size: var(--text-xs); text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--accent); font-weight: 600; margin: 0;
}
.insp-label {
  display: block; font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;
}
.insp-select, .insp-input {
  width: 100%; font-size: var(--text-xs);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--text);
}
.insp-delete {
  margin-top: auto; width: 100%; padding: var(--space-2);
  border: 1px solid var(--error-border, #fca5a5);
  color: var(--error-text, #dc2626); background: transparent;
  border-radius: var(--radius-md); cursor: pointer; font-size: var(--text-xs);
  transition: background var(--motion-fast);
  &:hover { background: var(--error-bg, #fee2e2); }
}
.insp-save {
  width: 100%; padding: var(--space-2);
  background: var(--accent); color: #fff;
  border: none; border-radius: var(--radius-md); cursor: pointer;
  font-size: var(--text-xs); font-weight: 600;
  transition: opacity var(--motion-fast);
  &:hover { opacity: 0.88; }
}
.insp-empty {
  font-size: var(--text-xs); color: var(--text-muted); text-align: center; padding: var(--space-4);
}
```

> **Budget note:** The component SCSS budget for `workflow-composer.page.ts` was raised to `maximumWarning: "12kB"`, `maximumError: "15kB"` in `angular.json` during Phase 1.6 (or raise it now if not already done). Verify this before building.

---

## 8. SVG Arrow Styling

Use a purple SVG `<marker>` for arrowheads, matching the Sweet accent color `var(--accent)` converted to its hex value (`#6941c6`):

```svg
<defs>
  <marker id="wf-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
    <path d="M0,0 L8,3 L0,6 Z" fill="#6941c6"/>
  </marker>
</defs>
```

Edges are cubic bezier SVG `<path>` elements:
- `stroke="#6941c6"`, `stroke-width="2"`, `fill="none"`, `marker-end="url(#wf-arrow)"`
- Control points: `dx = |bx - ax| * 0.4`
- Path: `M ax+45 ay C ax+45+dx ay, bx-45-dx by, bx-45 by`

---

## 9. Purity & Safety Constraints

- Do **NOT** modify `save()`, `build()`, `answer()`, or any existing gap/validation logic.
- Do **NOT** remove the `aria-label`, `aria-labelledby`, or keydown handlers on the textarea.
- Keep all existing signals and computed properties from Phases 1.5 and 1.6 intact.
- After editing, run `npm test` to confirm **all existing assertions still pass**.
- Then run `npm run build` to confirm the production bundle compiles successfully.
- Update `docs/agent/task.md`: mark Phase 1.7 items `[x]` after each step.

---

## 10. Update Task Ledger

After completing the implementation, add and check off this section in `docs/agent/task.md`:

```markdown
# Phase 1.7: Workflow Canvas Diagram (2026-07-18)

Spec: `docs/2026-07-18_workflow-canvas-diagram_v1.md`

- [x] Add `CanvasNode` / `CanvasEdge` interfaces and signals to `WorkflowComposerPage`
- [x] Implement `effect()` to rebuild canvas from rule signal (parser/3-col → canvas sync)
- [x] Implement `commitCanvasToRule()` (canvas → rule signal sync via `updateRule()`)
- [x] Build palette sidebar (drag + click to place)
- [x] Build canvas stage with dotted grid background and SVG edge overlay
- [x] Build node rendering (event circle, condition diamond, output circle)
- [x] Implement node drag-to-move
- [x] Implement port drag-to-connect (dashed temp line → edge on drop)
- [x] Implement click-connect mode
- [x] Build inspector panel (event/condition/output forms using existing picker groups)
- [x] Add `rebuildCanvasFromRule()` auto-layout (event→cond→output left-to-right)
- [x] Style canvas using Sweet design tokens — no hardcoded colors except node shapes
- [x] Raise SCSS budget in `angular.json` if needed
- [x] All tests pass (`npm test`)
- [x] Build succeeds (`npm run build`)
- [x] Commit as: `feat(composer): Phase 1.7 – visual workflow canvas diagram`
```
