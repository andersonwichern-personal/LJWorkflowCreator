import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import {
  ACTIONS,
  ConditionGroup,
  ConditionLeaf,
  ConditionNode,
  EVENTS,
  FieldDef,
  OPERATORS,
  RuleOutput,
  ScopeValue,
  WorkflowRule,
  allowedFieldsForTriggers,
  condFieldKey,
  condFieldKind,
  condFieldLabel,
  defaultParamFor,
  defaultValueFor,
  formatDelay,
  getAction,
  getEvent,
  isGroup,
  isValuelessOperator,
  opLabel,
  paramKeyFor,
  scopeLabel,
} from '../../../core/vocabulary';
import { addGroup, addLeaf, removeNode, updateLeaf } from '../../../core/conditionTree';
import { PickerOption, TokenPicker } from './token-picker';

/**
 * The WHEN / IF / THEN sentence — the Angular rebuild of the prototype's
 * RuleSentence, driven by the shared rule core. All edits are immutable: the
 * component never mutates `rule`, it emits a fresh object via `ruleChange`.
 *
 * First-cut scope (per the two-track doctrine): static vocabulary only — no
 * live form-field (ff:) refs and no ScopeRef *authoring* yet. Loaded rules
 * containing ScopeRef values still RENDER correctly via scopeLabel(); editing
 * such a value replaces it with the picked string.
 */
@Component({
  selector: 'wf-rule-sentence',
  imports: [TokenPicker, NgTemplateOutlet],
  template: `
    <div class="lane">
      <span class="kw when">WHEN</span>
      <div class="tokens">
        @for (trigger of rule.triggers; track $index) {
          @if ($index > 0) {
            <span class="joiner">or</span>
          }
          <wf-token-picker
            [label]="eventLabel(trigger.event)"
            [options]="eventOptions()"
            [unconfirmed]="eventUnconfirmed(trigger.event)"
            (selected)="setTrigger($index, $event)"
          />
          @if (rule.triggers.length > 1) {
            <button type="button" class="x" (click)="removeTrigger($index)" aria-label="Remove trigger">×</button>
          }
        }
        @if (rule.triggers.length < 3) {
          <wf-token-picker placeholder="+ or event" [options]="eventOptions()" (selected)="addTrigger($event)" />
        }
      </div>
    </div>

    <div class="lane">
      <span class="kw if">IF</span>
      <div class="tokens column">
        @if (rule.conditions.children.length === 0) {
          <span class="muted">no conditions — fires on every matching event</span>
        }
        @for (node of rule.conditions.children; track nodeIndex; let nodeIndex = $index) {
          <div class="row">
            @if (nodeIndex > 0) {
              <button type="button" class="logic" (click)="toggleRootLogic()">{{ rule.conditions.logic }}</button>
            }
            @if (isLeaf(node)) {
              <ng-container *ngTemplateOutlet="leafTpl; context: { leaf: node, path: [nodeIndex] }" />
            } @else {
              <div class="group">
                <span class="paren">(</span>
                @for (child of asGroup(node).children; track childIndex; let childIndex = $index) {
                  @if (childIndex > 0) {
                    <button type="button" class="logic" (click)="toggleGroupLogic(nodeIndex)">{{ asGroup(node).logic }}</button>
                  }
                  @if (isLeaf(child)) {
                    <ng-container *ngTemplateOutlet="leafTpl; context: { leaf: child, path: [nodeIndex, childIndex] }" />
                  }
                }
                <wf-token-picker placeholder="+ and" [options]="fieldOptions()" (selected)="addCondition($event, [nodeIndex])" />
                <span class="paren">)</span>
                <button type="button" class="x" (click)="removeAt([nodeIndex])" aria-label="Remove group">×</button>
              </div>
            }
          </div>
        }
        <div class="row adders">
          <wf-token-picker placeholder="+ and condition" [options]="fieldOptions()" (selected)="addCondition($event, [])" />
          @if (canAddGroup()) {
            <button type="button" class="ghost" (click)="addSubGroup()">⊕ group</button>
          }
        </div>
      </div>
    </div>

    <div class="lane">
      <span class="kw then">THEN</span>
      <div class="tokens column">
        @for (action of rule.actions; track $index) {
          <div class="row">
            <ng-container
              *ngTemplateOutlet="actionTpl; context: { output: action, index: $index, lane: 'actions' }"
            />
          </div>
        }
        <div class="row">
          <wf-token-picker placeholder="+ add action" [options]="actionOptions()" (selected)="addAction($event, 'actions')" />
        </div>
      </div>
    </div>

    <div class="lane">
      <span class="kw otherwise">OTHERWISE</span>
      <div class="tokens column">
        @for (action of rule.else ?? []; track $index) {
          <div class="row">
            <ng-container *ngTemplateOutlet="actionTpl; context: { output: action, index: $index, lane: 'else' }" />
          </div>
        }
        <div class="row">
          <wf-token-picker placeholder="+ otherwise action" [options]="actionOptions()" (selected)="addAction($event, 'else')" />
        </div>
      </div>
    </div>

    <ng-template #leafTpl let-leaf="leaf" let-path="path">
      <span class="leaf">
        <wf-token-picker
          [label]="fieldLabel(leaf)"
          [options]="fieldOptions()"
          (selected)="setLeafField(path, $event)"
        />
        <wf-token-picker
          [label]="operatorLabel(leaf)"
          [options]="operatorOptions(leaf)"
          (selected)="setLeafOperator(path, $event)"
        />
        @if (!valueless(leaf)) {
          <wf-token-picker
            [label]="valueLabel(leaf)"
            [options]="valueOptions(leaf)"
            [allowFreeText]="valueFreeText(leaf)"
            [validateFreeText]="valueValidator(leaf)"
            (selected)="setLeafValue(path, $event)"
          />
        }
        <button type="button" class="x" (click)="removeAt(path)" aria-label="Remove condition">×</button>
      </span>
    </ng-template>

    <ng-template #actionTpl let-output="output" let-index="index" let-lane="lane">
      <span class="leaf">
        <wf-token-picker
          [label]="actionLabel(output)"
          [options]="actionOptions()"
          [unconfirmed]="actionUnconfirmed(output)"
          (selected)="setAction(lane, index, $event)"
        />
        @if (actionHasParam(output)) {
          <wf-token-picker
            [label]="paramLabel(output)"
            [options]="paramOptions(output)"
            [allowFreeText]="true"
            (selected)="setActionParam(lane, index, $event)"
          />
        }
        @if (output.delayMinutes) {
          <span class="chip">{{ delayText(output) }}</span>
        }
        <button type="button" class="x" (click)="removeAction(lane, index)" aria-label="Remove action">×</button>
      </span>
    </ng-template>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    .lane { display: flex; gap: 14px; align-items: flex-start; }
    .kw {
      flex: 0 0 92px; text-align: right; font-size: 12px; font-weight: 800;
      letter-spacing: 0.08em; padding-top: 7px; color: var(--text-dim);
    }
    .kw.when { color: var(--brand-text); }
    .kw.then { color: var(--info); }
    .tokens { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; min-height: 30px; }
    .tokens.column { flex-direction: column; align-items: flex-start; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .leaf { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .joiner { font-size: 13px; color: var(--text-dim); font-style: italic; }
    .logic {
      font: inherit; font-size: 11px; font-weight: 800; letter-spacing: 0.06em;
      color: var(--text-dim); background: var(--surface-inset);
      border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px; cursor: pointer;
    }
    .logic:hover { color: var(--text); border-color: var(--brand); }
    .group {
      display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center;
      border: 1px dashed var(--border); border-radius: 12px; padding: 6px 10px;
    }
    .paren { color: var(--text-dim); font-weight: 700; }
    .x {
      font: inherit; font-size: 14px; line-height: 1; color: var(--text-dim);
      background: none; border: 0; cursor: pointer; padding: 2px 4px; border-radius: 6px;
    }
    .x:hover { color: var(--danger); background: var(--surface-hover); }
    .ghost {
      font: inherit; font-size: 12px; font-weight: 600; color: var(--text-dim);
      background: none; border: 1px dashed var(--border); border-radius: 999px;
      padding: 4px 12px; cursor: pointer;
    }
    .ghost:hover { color: var(--text); border-color: var(--brand); }
    .chip {
      font-size: 11px; font-weight: 700; color: var(--info);
      background: color-mix(in srgb, var(--info) 12%, transparent);
      border-radius: 999px; padding: 2px 8px;
    }
    .muted { font-size: 13px; color: var(--text-dim); font-style: italic; padding-top: 5px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuleSentence {
  @Input({ required: true }) rule!: WorkflowRule;
  @Output() ruleChange = new EventEmitter<WorkflowRule>();

  /* ---- emit helper -------------------------------------------------------- */
  private emit(mutate: (draft: WorkflowRule) => void) {
    const draft = structuredClone(this.rule);
    mutate(draft);
    this.ruleChange.emit(draft);
  }

  /* ---- template narrowing ------------------------------------------------- */
  protected isLeaf(node: ConditionNode): node is ConditionLeaf {
    return !isGroup(node);
  }
  protected asGroup(node: ConditionNode): ConditionGroup {
    return node as ConditionGroup;
  }

  /* ---- WHEN ---------------------------------------------------------------- */
  protected eventOptions(): PickerOption[] {
    return EVENTS.map((e) => ({
      value: e.key,
      label: e.label,
      unconfirmed: e.confidence !== 'verified',
    }));
  }
  protected eventLabel(key: string): string {
    return getEvent(key)?.label ?? key;
  }
  protected eventUnconfirmed(key: string): boolean {
    return getEvent(key)?.confidence !== 'verified';
  }
  protected setTrigger(index: number, event: string) {
    this.emit((draft) => (draft.triggers[index] = { event }));
  }
  protected addTrigger(event: string) {
    this.emit((draft) => draft.triggers.push({ event }));
  }
  protected removeTrigger(index: number) {
    if (this.rule.triggers.length <= 1) return; // never remove the last trigger
    this.emit((draft) => draft.triggers.splice(index, 1));
  }

  /* ---- IF ------------------------------------------------------------------ */
  private allowedFields(): FieldDef[] {
    return allowedFieldsForTriggers(this.rule.triggers.map((t) => t.event));
  }
  protected fieldOptions(): PickerOption[] {
    return this.allowedFields().map((f) => ({
      value: f.key,
      label: f.label,
      hint: f.group,
      unconfirmed: f.confidence !== 'verified',
    }));
  }
  protected fieldLabel(leaf: ConditionLeaf): string {
    return condFieldLabel(leaf.field);
  }
  protected operatorLabel(leaf: ConditionLeaf): string {
    return opLabel(condFieldKind(leaf.field), leaf.operator);
  }
  protected operatorOptions(leaf: ConditionLeaf): PickerOption[] {
    return OPERATORS[condFieldKind(leaf.field)].map((o) => ({ value: o.value, label: o.label }));
  }
  protected valueless(leaf: ConditionLeaf): boolean {
    return isValuelessOperator(leaf.operator);
  }
  protected valueLabel(leaf: ConditionLeaf): string {
    return scopeLabel(leaf.value as ScopeValue) || '';
  }
  protected valueOptions(leaf: ConditionLeaf): PickerOption[] {
    const def = this.fieldDef(leaf);
    return (def?.options ?? []).map((option) => ({ value: option, label: option }));
  }
  protected valueFreeText(leaf: ConditionLeaf): boolean {
    const kind = condFieldKind(leaf.field);
    return kind === 'text' || kind === 'numeric';
  }
  protected valueValidator(leaf: ConditionLeaf): ((v: string) => string | null) | null {
    if (condFieldKind(leaf.field) !== 'numeric') return null;
    return (v) => (isNaN(Number(v.replace(/[$,\s]/g, ''))) ? 'Enter a number' : null);
  }
  private fieldDef(leaf: ConditionLeaf): FieldDef | undefined {
    return this.allowedFields().find((f) => f.key === condFieldKey(leaf.field));
  }

  protected addCondition(fieldKey: string, path: number[]) {
    const def = this.allowedFields().find((f) => f.key === fieldKey);
    if (!def) return;
    const leaf: ConditionLeaf = {
      field: def.key,
      operator: OPERATORS[def.kind][0].value,
      value: defaultValueFor(def),
    };
    this.ruleChange.emit({ ...this.rule, conditions: addLeaf(this.rule.conditions, path, leaf) });
  }
  protected addSubGroup() {
    this.ruleChange.emit({
      ...this.rule,
      conditions: addGroup(this.rule.conditions, [], { logic: 'OR', children: [] }),
    });
  }
  protected canAddGroup(): boolean {
    // UI cap: root + one sub-group level (validator allows 4 for programmatic writers).
    return this.rule.conditions.children.length > 0;
  }
  protected removeAt(path: number[]) {
    this.ruleChange.emit({ ...this.rule, conditions: removeNode(this.rule.conditions, path) });
  }
  private patchLeaf(path: number[], patch: Partial<ConditionLeaf>) {
    let node: ConditionNode = this.rule.conditions.children[path[0]];
    if (path.length === 2 && isGroup(node)) node = node.children[path[1]];
    if (!node || isGroup(node)) return;
    const leaf = { ...node, ...patch } as ConditionLeaf;
    this.ruleChange.emit({ ...this.rule, conditions: updateLeaf(this.rule.conditions, path, leaf) });
  }
  protected setLeafField(path: number[], fieldKey: string) {
    const def = this.allowedFields().find((f) => f.key === fieldKey);
    if (!def) return;
    this.patchLeaf(path, {
      field: def.key,
      operator: OPERATORS[def.kind][0].value,
      value: defaultValueFor(def),
    });
  }
  protected setLeafOperator(path: number[], operator: string) {
    this.patchLeaf(path, { operator });
  }
  protected setLeafValue(path: number[], value: string) {
    this.patchLeaf(path, { value });
  }
  protected toggleRootLogic() {
    this.emit((draft) => (draft.conditions.logic = draft.conditions.logic === 'AND' ? 'OR' : 'AND'));
  }
  protected toggleGroupLogic(index: number) {
    this.emit((draft) => {
      const node = draft.conditions.children[index];
      if (isGroup(node)) node.logic = node.logic === 'AND' ? 'OR' : 'AND';
    });
  }

  /* ---- THEN / OTHERWISE ---------------------------------------------------- */
  protected actionOptions(): PickerOption[] {
    return ACTIONS.map((a) => ({
      value: a.key,
      label: a.label,
      unconfirmed: a.confidence !== 'verified',
      hint: a.execution.status === 'executable-now' ? undefined : a.execution.status,
    }));
  }
  protected actionLabel(output: RuleOutput): string {
    return getAction(output.action)?.label ?? output.action;
  }
  protected actionUnconfirmed(output: RuleOutput): boolean {
    return getAction(output.action)?.confidence !== 'verified';
  }
  protected actionHasParam(output: RuleOutput): boolean {
    return getAction(output.action)?.paramKind !== 'none';
  }
  protected paramLabel(output: RuleOutput): string {
    return scopeLabel(output.params[paramKeyFor(output.action)]) || '';
  }
  protected paramOptions(output: RuleOutput): PickerOption[] {
    return (getAction(output.action)?.paramOptions ?? []).map((o) => ({ value: o, label: o }));
  }
  protected delayText(output: RuleOutput): string {
    const minutes = output.delayMinutes ?? 0;
    return minutes < 0 ? `${formatDelay(-minutes)} before` : `after ${formatDelay(minutes)}`;
  }

  private lane(draft: WorkflowRule, lane: 'actions' | 'else'): RuleOutput[] {
    if (lane === 'else') return (draft.else ??= []);
    return draft.actions;
  }
  protected addAction(actionKey: string, lane: 'actions' | 'else') {
    const def = getAction(actionKey);
    if (!def) return;
    this.emit((draft) => this.lane(draft, lane).push({ action: def.key, params: defaultParamFor(def) }));
  }
  protected setAction(lane: 'actions' | 'else', index: number, actionKey: string) {
    const def = getAction(actionKey);
    if (!def) return;
    this.emit((draft) => (this.lane(draft, lane)[index] = { action: def.key, params: defaultParamFor(def) }));
  }
  protected setActionParam(lane: 'actions' | 'else', index: number, value: string) {
    this.emit((draft) => {
      const output = this.lane(draft, lane)[index];
      output.params = { ...output.params, [paramKeyFor(output.action)]: value };
    });
  }
  protected removeAction(lane: 'actions' | 'else', index: number) {
    this.emit((draft) => {
      this.lane(draft, lane).splice(index, 1);
      if (lane === 'else' && draft.else?.length === 0) delete draft.else;
    });
  }
}
