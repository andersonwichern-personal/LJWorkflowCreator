"use client";

import { useState } from "react";
import {
  WorkflowRule,
  EVENTS,
  FIELD_GROUPS,
  ACTIONS,
  OPERATORS,
  getEvent,
  getAction,
  allowedFieldsForTriggers,
  triggersAllowFormFields,
  opLabel,
  paramKeyFor,
  defaultValueFor,
  defaultParamFor,
  ruleUsesUnconfirmed,
  RuleCondition,
  RuleOutput,
  RuleControls,
  ConditionGroup,
  ConditionNode,
  ConditionLeaf,
  ConditionFieldRef,
  ScopeRef,
  ScopeSpec,
  SCOPED_FIELDS,
  SCOPED_PARAMS,
  isLegacyString,
  scopeLabel,
  scopeInstanceId,
  isGroup,
  isFormFieldRef,
  condFieldKey,
  condFieldLabel,
  condFieldKind,
  condFieldDef,
  isValuelessOperator,
  walkLeaves,
} from "@/lib/vocabulary";
import {
  addLeaf as tAddLeaf,
  addGroup as tAddGroup,
  updateLeaf as tUpdateLeaf,
  removeNode as tRemoveNode,
  setGroupLogic as tSetGroupLogic,
  nodeAt,
  emptyGroup,
} from "@/lib/conditionTree";
import TokenPicker, { PickerOption, ScopedOptions } from "./TokenPicker";
import { VocabOverlay, ScopedInstances, fieldKindForType } from "@/lib/liveVocabulary";
import { UnresolvedSlot } from "@/lib/nlParser";

type Lane = "then" | "else";

type Open =
  | { kind: "event"; ti: number }
  | { kind: "add-trigger" }
  | { kind: "trigger-scope"; ti: number }
  | { kind: "cond-field"; path: number[] }
  | { kind: "cond-op"; path: number[] }
  | { kind: "cond-value"; path: number[] }
  | { kind: "add-cond"; path: number[] }
  | { kind: "action"; lane: Lane; i: number }
  | { kind: "action-param"; lane: Lane; i: number }
  | { kind: "add-action"; lane: Lane };

/** Pseudo-team categories are unconfirmed (plan §4.2) — badge them. */
const TEAM_CATEGORIES = new Set(["Underwriting Team", "Booking Team", "Escalation Team", "Operations Team"]);

/** Build the picker's scoped sections for a field/param spec + live overlay. */
function scopedFor(spec: ScopeSpec | undefined, overlay?: VocabOverlay | null): ScopedOptions | undefined {
  if (!spec) return undefined;
  const source = spec.instanceSource;
  const live: { id: string; label: string }[] =
    source && overlay ? (overlay.instances[source as keyof ScopedInstances] ?? []) : [];
  return {
    categories: spec.categories.map((c) => ({
      value: c,
      label: c,
      confidence: TEAM_CATEGORIES.has(c) ? ("unconfirmed" as const) : undefined,
    })),
    instances: live.map((o) => ({ value: o.id, label: o.label })),
    instancesDisabledHint: spec.instancesDisabledHint,
  };
}

type Palette = "when" | "if" | "then" | "op" | "danger";

function paletteStyle(p: Palette): React.CSSProperties {
  if (p === "op") return { background: "var(--tok-op-bg)", color: "var(--tok-op-fg)", borderColor: "transparent" };
  if (p === "danger") return { background: "var(--danger-bg)", color: "var(--danger-fg)", borderColor: "var(--danger-br)" };
  return { background: `var(--tok-${p}-bg)`, color: `var(--tok-${p}-fg)`, borderColor: `var(--tok-${p}-br)` };
}

function Pill({
  children,
  palette,
  onClick,
  unconfirmed,
  dashed,
}: {
  children: React.ReactNode;
  palette: Palette;
  onClick?: (el: HTMLElement) => void;
  unconfirmed?: boolean;
  dashed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => onClick?.(e.currentTarget)}
      className="ring-accent group relative inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[15px] font-medium leading-tight transition-all duration-150 hover:-translate-y-px hover:shadow-sm"
      style={{ ...paletteStyle(palette), borderStyle: dashed ? "dashed" : "solid" }}
    >
      {children}
      {unconfirmed && (
        <span
          className="ml-0.5 rounded-full px-1 py-px text-[9px] font-bold uppercase leading-none"
          style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }}
          title="Unconfirmed against the live platform"
        >
          ?
        </span>
      )}
    </button>
  );
}

function Word({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[13px] font-bold uppercase tracking-widest" style={{ color: "var(--fg-subtle)" }}>
      {children}
    </span>
  );
}

/** Format a condition value for display (adds unit + thousands separators). */
function displayValue(c: RuleCondition): string {
  if (!c.value) return "value";
  if (!isLegacyString(c.value)) {
    // Structured ScopeRef — total rendering, never "[object Object]".
    if (c.value.level === "any") return `any ${condFieldLabel(c.field)}`;
    return scopeLabel(c.value);
  }
  if (condFieldKind(c.field) === "numeric") {
    const n = Number(c.value);
    const formatted = isNaN(n) ? c.value : n.toLocaleString("en-US");
    return `${condFieldDef(c.field)?.unit ?? ""}${formatted}`;
  }
  return c.value;
}

/** Encode a live form field as a picker value (decoded back in refForPickerValue). */
const FF_PREFIX = "ff:";

/** Build grouped field options for the picker — static vocab + live ID-bound form fields. */
function fieldOptionsFor(events: string[], overlay?: VocabOverlay | null): PickerOption[] {
  const groupIcon = (g: string) => FIELD_GROUPS.find((x) => x.key === g)?.icon;
  const staticOpts = allowedFieldsForTriggers(events)
    .slice()
    .sort(
      (a, b) =>
        FIELD_GROUPS.findIndex((g) => g.key === a.group) -
        FIELD_GROUPS.findIndex((g) => g.key === b.group)
    )
    .map((f) => ({
      value: f.key,
      label: f.label,
      confidence: f.confidence,
      hint: f.hint,
      group: f.group,
      groupIcon: groupIcon(f.group),
    }));
  // Real per-template fields — only when EVERY trigger allows form fields (§3.1).
  const liveOpts = triggersAllowFormFields(events)
    ? (overlay?.liveFields ?? []).map((f) => ({
        value: `${FF_PREFIX}${f.formTemplateId}:${f.fieldId}`,
        label: f.label,
        confidence: "verified" as const,
        group: `${f.formName} (live)`,
        groupIcon: "🌾",
      }))
    : [];
  return [...staticOpts, ...liveOpts];
}

interface RuleSentenceProps {
  rule: WorkflowRule;
  onChange: (rule: WorkflowRule) => void;
  /** Live platform values overlaid on the static picker options (demo bridge). */
  overlay?: VocabOverlay | null;
  /** Parser slots awaiting a human pick (N1) — rendered as danger pills. */
  unresolved?: UnresolvedSlot[];
  /** Called when the user resolves a slot by picking a value. */
  onResolve?: (slot: UnresolvedSlot) => void;
}

export default function RuleSentence({ rule, onChange, overlay, unresolved, onResolve }: RuleSentenceProps) {
  const [open, setOpen] = useState<Open | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);

  function openPicker(state: Open, el: HTMLElement) {
    setOpen(state);
    setAnchor(el);
  }
  function close() {
    setOpen(null);
    setAnchor(null);
  }

  const triggers = rule.triggers;
  const events = triggers.map((t) => t.event);
  const root = rule.conditions;
  const actions = rule.actions;
  const elseActions = rule.else ?? [];

  // Flattened leaves — used to map parser slots (flat conditionIndex) to leaves.
  const flatLeaves = walkLeaves(root);

  const slotForLeaf = (leaf: ConditionLeaf) =>
    unresolved?.find((s) => s.where === "condition-value" && s.conditionIndex === flatLeaves.indexOf(leaf));
  const actionSlot = (lane: Lane, i: number) =>
    lane === "then" ? unresolved?.find((s) => s.where === "action-param" && s.actionIndex === i) : undefined;

  /** Suggestions-first option list for a slot's picker. */
  function slotOptions(slot: UnresolvedSlot, base: PickerOption[]): PickerOption[] {
    const suggested = slot.suggestions.map((s) => ({ value: s, label: s }));
    const seen = new Set(slot.suggestions.map((s) => s.toLowerCase()));
    return [...suggested, ...base.filter((o) => !seen.has(o.label.toLowerCase()))];
  }

  /* ---- trigger mutators ---- */
  function retriggered(newTriggers: { event: string }[]) {
    const evs = newTriggers.map((t) => t.event);
    const allowed = new Set(allowedFieldsForTriggers(evs).map((f) => f.key));
    const allowFF = triggersAllowFormFields(evs);
    onChange({ ...rule, triggers: newTriggers, conditions: pruneGroup(root, allowed, allowFF) });
  }
  function setEventAt(ti: number, ev: string) {
    retriggered(triggers.map((t, i) => (i === ti ? { event: ev } : t)));
  }
  function addTrigger(ev: string) {
    if (triggers.length >= 3 || triggers.some((t) => t.event === ev)) return;
    retriggered([...triggers, { event: ev }]);
  }
  function removeTrigger(ti: number) {
    if (triggers.length <= 1) return;
    retriggered(triggers.filter((_, i) => i !== ti));
  }
  /** Set/clear a trigger's template scope ("any" = absent, keeps JSON minimal). */
  function setTriggerScope(ti: number, scope?: ScopeRef) {
    onChange({
      ...rule,
      triggers: triggers.map((t, i) =>
        i === ti ? (scope && scope.level !== "any" ? { ...t, scope } : { event: t.event }) : t
      ),
    });
  }

  /* ---- condition-tree mutators (pure via conditionTree.ts) ---- */
  function setTree(next: ConditionGroup) {
    onChange({ ...rule, conditions: next });
  }
  /** Decode a picker value into a condition field ref (attribute key or live form field). */
  function refForPickerValue(v: string): ConditionFieldRef {
    if (v.startsWith(FF_PREFIX)) {
      const [formTemplateId, fieldId] = v.slice(FF_PREFIX.length).split(":");
      const live = overlay?.liveFields.find((f) => f.formTemplateId === formTemplateId && f.fieldId === fieldId);
      return {
        kind: "formField",
        formTemplateId,
        fieldId,
        key: live?.name,
        label: live?.label,
        fieldKind: live ? fieldKindForType(live.fieldType) : "text",
      };
    }
    return v;
  }
  function newLeaf(pickerValue: string): ConditionLeaf {
    const ref = refForPickerValue(pickerValue);
    const kind = condFieldKind(ref);
    const def = condFieldDef(ref);
    return { field: ref, operator: OPERATORS[kind][0].value, value: def ? defaultValueFor(def) : "" };
  }
  function addLeafAt(path: number[], pickerValue: string) {
    setTree(tAddLeaf(root, path, newLeaf(pickerValue)));
  }
  function addSubGroup() {
    setTree(tAddGroup(root, [], emptyGroup("OR")));
  }
  function updateLeafAt(path: number[], patch: Partial<ConditionLeaf>) {
    const cur = nodeAt(root, path);
    if (!cur || isGroup(cur)) return;
    setTree(tUpdateLeaf(root, path, { ...cur, ...patch }));
  }
  function removeAt(path: number[]) {
    setTree(tRemoveNode(root, path));
  }
  function toggleGroupLogic(path: number[]) {
    const g = nodeAt(root, path);
    if (!g || !isGroup(g)) return;
    setTree(tSetGroupLogic(root, path, g.logic === "AND" ? "OR" : "AND"));
  }
  const leafAt = (path: number[]): ConditionLeaf | undefined => {
    const n = nodeAt(root, path);
    return n && !isGroup(n) ? n : undefined;
  };

  /* ---- action mutators (then / else lanes) ---- */
  const laneActions = (lane: Lane) => (lane === "then" ? actions : elseActions);
  function setLane(lane: Lane, arr: RuleOutput[]) {
    if (lane === "then") onChange({ ...rule, actions: arr });
    else onChange({ ...rule, else: arr.length ? arr : undefined });
  }
  function addActionTo(lane: Lane, actionKey: string) {
    const def = getAction(actionKey)!;
    setLane(lane, [...laneActions(lane), { action: actionKey, params: defaultParamFor(def) }]);
  }
  function updateActionAt(lane: Lane, i: number, patch: Partial<RuleOutput>) {
    setLane(lane, laneActions(lane).map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }
  function removeActionAt(lane: Lane, i: number) {
    setLane(lane, laneActions(lane).filter((_, idx) => idx !== i));
  }

  /* ---- controls ---- */
  function setControls(patch: Partial<RuleControls>) {
    if (patch.mode === "armed" && rule.controls.mode !== "armed" && ruleUsesUnconfirmed(rule)) {
      const ok = window.confirm(
        "This rule uses vocabulary not yet confirmed against the live platform. Arming it lets it take real action on triggers the backend may not emit or execute. Arm anyway?"
      );
      if (!ok) return;
    }
    onChange({ ...rule, controls: { ...rule.controls, ...patch } });
  }

  /* ---- option builders ---- */
  const fieldOptions = fieldOptionsFor(events, overlay);
  const actionOptions: PickerOption[] = ACTIONS.map((a) => ({
    value: a.key,
    label: a.label,
    confidence: a.confidence,
    hint: a.blurb,
  }));
  const triggerAddOptions: PickerOption[] = EVENTS.filter((e) => !events.includes(e.key)).map((e) => ({
    value: e.key,
    label: e.label,
    confidence: e.confidence,
    hint: e.blurb,
  }));
  const eventOptions: PickerOption[] = EVENTS.map((e) => ({
    value: e.key,
    label: e.label,
    confidence: e.confidence,
    hint: e.blurb,
  }));

  /* ---- leaf render (shared by root + sub-groups) ---- */
  function renderLeaf(leaf: ConditionLeaf, path: number[]) {
    const slot = slotForLeaf(leaf);
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-1 py-0.5"
        style={{ borderColor: "var(--tok-if-br)" }}
      >
        <Pill
          palette="if"
          unconfirmed={condFieldDef(leaf.field)?.confidence === "unconfirmed"}
          onClick={(el) => openPicker({ kind: "cond-field", path }, el)}
        >
          {condFieldLabel(leaf.field)}
        </Pill>
        <button
          type="button"
          onClick={(e) => openPicker({ kind: "cond-op", path }, e.currentTarget)}
          className="ring-accent rounded-md px-1 text-[13px] font-medium lowercase transition-colors hover:bg-[var(--accent-soft)]"
          style={{ color: "var(--fg-muted)" }}
        >
          {opLabel(condFieldKind(leaf.field), leaf.operator)}
        </button>
        {!isValuelessOperator(leaf.operator) &&
          (slot && !leaf.value ? (
            <Pill palette="danger" onClick={(el) => openPicker({ kind: "cond-value", path }, el)}>
              needs your pick
            </Pill>
          ) : (
            <Pill palette="if" onClick={(el) => openPicker({ kind: "cond-value", path }, el)}>
              {displayValue(leaf)}
            </Pill>
          ))}
        <button
          type="button"
          onClick={() => removeAt(path)}
          aria-label="Remove condition"
          className="ring-accent mr-0.5 flex h-5 w-5 items-center justify-center rounded-full text-xs transition-colors hover:bg-[var(--accent-soft)]"
          style={{ color: "var(--fg-subtle)" }}
        >
          ×
        </button>
      </span>
    );
  }

  /** Render the children of a group, connectors carrying that group's logic. */
  function renderChildren(group: ConditionGroup, groupPath: number[]) {
    return group.children.map((child: ConditionNode, i) => {
      const path = [...groupPath, i];
      const connector =
        i > 0 ? (
          <Pill palette="op" onClick={() => toggleGroupLogic(groupPath)}>
            {group.logic}
          </Pill>
        ) : null;
      if (isGroup(child)) {
        return (
          <span key={i} className="inline-flex flex-wrap items-center gap-2">
            {connector}
            <span
              className="inline-flex flex-wrap items-center gap-2 rounded-2xl border px-2 py-1.5"
              style={{ borderColor: "var(--tok-if-br)", background: "var(--accent-soft)" }}
            >
              <span className="text-[13px] font-bold" style={{ color: "var(--fg-subtle)" }}>(</span>
              {renderChildren(child, path)}
              <Pill palette="if" dashed onClick={(el) => openPicker({ kind: "add-cond", path }, el)}>
                + {child.logic.toLowerCase()}
              </Pill>
              <button
                type="button"
                onClick={() => removeAt(path)}
                aria-label="Remove group"
                className="ring-accent flex h-5 w-5 items-center justify-center rounded-full text-xs transition-colors hover:bg-[var(--danger-bg)]"
                style={{ color: "var(--fg-subtle)" }}
              >
                ×
              </button>
              <span className="text-[13px] font-bold" style={{ color: "var(--fg-subtle)" }}>)</span>
            </span>
          </span>
        );
      }
      return (
        <span key={i} className="inline-flex flex-wrap items-center gap-2">
          {connector}
          {renderLeaf(child, path)}
        </span>
      );
    });
  }

  /* ---- action lane render ---- */
  function renderActionLane(list: RuleOutput[], lane: Lane) {
    return list.map((o, i) => {
      const action = getAction(o.action);
      const key = paramKeyFor(o.action);
      const paramVal = scopeLabel(o.params[key]);
      const hasParam = action?.paramKind !== "none";
      const slot = actionSlot(lane, i);
      return (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-1 py-0.5"
            style={{ borderColor: "var(--tok-then-br)" }}
          >
            <Pill
              palette="then"
              unconfirmed={action?.confidence === "unconfirmed"}
              onClick={(el) => openPicker({ kind: "action", lane, i }, el)}
            >
              {action?.label ?? o.action}
            </Pill>
            {hasParam &&
              (slot && !paramVal ? (
                <Pill palette="danger" onClick={(el) => openPicker({ kind: "action-param", lane, i }, el)}>
                  needs your pick
                </Pill>
              ) : (
                <Pill palette="then" onClick={(el) => openPicker({ kind: "action-param", lane, i }, el)}>
                  {paramVal || action?.paramLabel || "value"}
                </Pill>
              ))}
            <button
              type="button"
              onClick={() => removeActionAt(lane, i)}
              aria-label="Remove action"
              className="ring-accent mr-0.5 flex h-5 w-5 items-center justify-center rounded-full text-xs transition-colors hover:bg-[var(--accent-soft)]"
              style={{ color: "var(--fg-subtle)" }}
            >
              ×
            </button>
          </span>
        </span>
      );
    });
  }

  const openLeaf = open && "path" in open ? leafAt(open.path) : undefined;

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3 leading-relaxed" style={{ color: "var(--fg)" }}>
        {/* WHEN — multiple triggers joined by "or" */}
        <Word>When</Word>
        {triggers.map((t, ti) => {
          const ev = getEvent(t.event);
          return (
            <span key={ti} className="inline-flex items-center gap-2">
              {ti > 0 && <Word>or</Word>}
              <span className="inline-flex items-center gap-1 rounded-full border px-1 py-0.5" style={{ borderColor: "var(--tok-when-br)" }}>
                <Pill palette="when" unconfirmed={ev?.confidence === "unconfirmed"} onClick={(el) => openPicker({ kind: "event", ti }, el)}>
                  {ev?.label ?? t.event}
                </Pill>
                <button
                  type="button"
                  onClick={(e) => openPicker({ kind: "trigger-scope", ti }, e.currentTarget)}
                  title={t.scope ? `Scoped to ${scopeLabel(t.scope)}` : "Scope this trigger to a specific template"}
                  className="ring-accent rounded-md px-1 text-[11px] font-medium transition-colors hover:bg-[var(--accent-soft)]"
                  style={{ color: t.scope ? "var(--accent)" : "var(--fg-subtle)" }}
                >
                  {t.scope ? `⌖ ${scopeLabel(t.scope)}` : "⌖ any"}
                </button>
                {triggers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTrigger(ti)}
                    aria-label="Remove trigger"
                    className="ring-accent mr-0.5 flex h-5 w-5 items-center justify-center rounded-full text-xs transition-colors hover:bg-[var(--accent-soft)]"
                    style={{ color: "var(--fg-subtle)" }}
                  >
                    ×
                  </button>
                )}
              </span>
            </span>
          );
        })}
        {triggers.length < 3 && (
          <Pill palette="when" dashed onClick={(el) => openPicker({ kind: "add-trigger" }, el)}>
            + or event
          </Pill>
        )}

        {/* IF — recursive condition tree */}
        {root.children.length > 0 && <Word>If</Word>}
        {renderChildren(root, [])}
        <Pill palette="if" dashed onClick={(el) => openPicker({ kind: "add-cond", path: [] }, el)}>
          {root.children.length ? "+ and" : "+ add condition"}
        </Pill>
        <Pill palette="if" dashed onClick={() => addSubGroup()}>
          ⊕ group
        </Pill>

        {/* THEN */}
        <Word>Then</Word>
        {renderActionLane(actions, "then")}
        <Pill palette="then" dashed onClick={(el) => openPicker({ kind: "add-action", lane: "then" }, el)}>
          {actions.length ? "+ action" : "+ add action"}
        </Pill>
      </div>

      {/* OTHERWISE (else) lane */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {elseActions.length > 0 ? (
          <>
            <Word>Otherwise</Word>
            {renderActionLane(elseActions, "else")}
            <Pill palette="then" dashed onClick={(el) => openPicker({ kind: "add-action", lane: "else" }, el)}>
              + action
            </Pill>
          </>
        ) : (
          <Pill palette="then" dashed onClick={(el) => openPicker({ kind: "add-action", lane: "else" }, el)}>
            + otherwise
          </Pill>
        )}
      </div>

      {/* Controls */}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setControlsOpen((o) => !o)}
          className="ring-accent inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium"
          style={{ borderColor: "var(--panel-border)", color: "var(--fg-muted)" }}
        >
          ⚙ controls
        </button>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
          style={
            rule.controls.mode === "armed"
              ? { background: "var(--tok-then-bg)", color: "var(--tok-then-fg)" }
              : { background: "var(--tok-op-bg)", color: "var(--fg-subtle)" }
          }
        >
          {rule.controls.mode}
        </span>
        {rule.controls.mode === "shadow" && (
          <span className="text-[11px]" style={{ color: "var(--fg-subtle)" }}>
            observing — logs matches without taking action
          </span>
        )}
      </div>

      {controlsOpen && <ControlsPanel controls={rule.controls} onChange={setControls} />}

      {/* Pickers */}
      {open?.kind === "event" && (
        <TokenPicker
          anchor={anchor}
          title="Trigger event"
          options={eventOptions}
          value={triggers[open.ti]?.event}
          onSelect={(v) => { setEventAt(open.ti, v); close(); }}
          onClose={close}
        />
      )}

      {open?.kind === "add-trigger" && (
        <TokenPicker
          anchor={anchor}
          title="Add trigger (OR)"
          options={triggerAddOptions}
          onSelect={(v) => { addTrigger(v); close(); }}
          onClose={close}
        />
      )}

      {open?.kind === "trigger-scope" && (
        <TokenPicker
          anchor={anchor}
          title="Trigger scope"
          options={[]}
          scoped={{
            categories: [],
            instances: (overlay?.instances.templates ?? []).map((t) => ({ value: t.id, label: t.label })),
            instancesDisabledHint: overlay?.instances.templates.length
              ? undefined
              : "Template scoping needs the live platform connection — the trigger stays unscoped.",
          }}
          onSelect={() => close()}
          onSelectScope={(ref) => { setTriggerScope(open.ti, ref); close(); }}
          onClose={close}
        />
      )}

      {open?.kind === "add-cond" && (
        <TokenPicker
          anchor={anchor}
          title="Add condition"
          options={fieldOptions}
          onSelect={(v) => { addLeafAt(open.path, v); close(); }}
          onClose={close}
        />
      )}

      {open?.kind === "cond-field" && (
        <TokenPicker
          anchor={anchor}
          title="Condition field"
          options={fieldOptions}
          value={openLeaf ? condFieldKey(openLeaf.field) : undefined}
          onSelect={(v) => {
            const ref = refForPickerValue(v);
            const kind = condFieldKind(ref);
            const def = condFieldDef(ref);
            updateLeafAt(open.path, { field: ref, operator: OPERATORS[kind][0].value, value: def ? defaultValueFor(def) : "" });
            close();
          }}
          onClose={close}
        />
      )}

      {open?.kind === "cond-op" &&
        (() => {
          const kind = condFieldKind(openLeaf?.field ?? "");
          const opts: PickerOption[] = OPERATORS[kind].map((o) => ({ value: o.value, label: o.label }));
          return (
            <TokenPicker
              anchor={anchor}
              title="Operator"
              options={opts}
              value={openLeaf?.operator}
              onSelect={(v) => {
                updateLeafAt(open.path, { operator: v, ...(isValuelessOperator(v) ? { value: "" } : {}) });
                close();
              }}
              onClose={close}
            />
          );
        })()}

      {open?.kind === "cond-value" &&
        (() => {
          const cond = openLeaf;
          const slot = cond ? slotForLeaf(cond) : undefined;
          const kind = condFieldKind(cond?.field ?? "");
          const def = condFieldDef(cond?.field ?? "");
          const label = condFieldLabel(cond?.field ?? "");
          const isEnum = (kind === "enum" || kind === "orderedEnum") && !!def;
          const isNum = kind === "numeric";
          // Scoped (category/instance) picker for instance-shaped fields (§4.2).
          const scoped =
            typeof cond?.field === "string" ? scopedFor(SCOPED_FIELDS[cond.field], overlay) : undefined;
          const values =
            (typeof cond?.field === "string" ? overlay?.fieldOptions[cond.field] : undefined) ?? def?.options ?? [];
          let opts: PickerOption[] = values.map((o) => ({ value: o, label: o }));
          if (slot) opts = slotOptions(slot, opts);
          const currentValue = cond ? (scopeInstanceId(cond.value) ?? scopeLabel(cond.value)) : undefined;
          return (
            <TokenPicker
              anchor={anchor}
              title={slot ? `${label} — you wrote "${slot.heard}"` : label || "Value"}
              options={opts}
              value={currentValue}
              freeText={!isEnum}
              numeric={isNum}
              validate={
                isNum
                  ? (v) => (isNaN(Number(v.replace(/,/g, ""))) ? "Enter a number — this condition would never match." : null)
                  : undefined
              }
              freeTextPlaceholder={isNum ? "Enter an amount…" : `Enter ${label || "value"}…`}
              scoped={scoped}
              onSelectScope={(ref) => {
                updateLeafAt(open.path, { value: ref });
                if (slot) onResolve?.(slot);
                close();
              }}
              onSelect={(v) => {
                updateLeafAt(open.path, { value: v });
                if (slot) onResolve?.(slot);
                close();
              }}
              onClose={close}
            />
          );
        })()}

      {open?.kind === "action" && (
        <TokenPicker
          anchor={anchor}
          title="Action"
          options={actionOptions}
          value={laneActions(open.lane)[open.i]?.action}
          onSelect={(v) => {
            const def = getAction(v)!;
            updateActionAt(open.lane, open.i, { action: v, params: defaultParamFor(def) });
            close();
          }}
          onClose={close}
        />
      )}

      {open?.kind === "add-action" && (
        <TokenPicker
          anchor={anchor}
          title="Add action"
          options={actionOptions}
          onSelect={(v) => { addActionTo(open.lane, v); close(); }}
          onClose={close}
        />
      )}

      {open?.kind === "action-param" &&
        (() => {
          const output = laneActions(open.lane)[open.i];
          const slot = actionSlot(open.lane, open.i);
          const action = getAction(output?.action);
          const isEnum = action?.paramKind === "enum";
          // Scoped (category/instance) picker for instance-shaped params (§4.2).
          const scoped = scopedFor(SCOPED_PARAMS[output?.action ?? ""], overlay);
          const values = overlay?.actionParamOptions[output?.action] ?? action?.paramOptions ?? [];
          let opts: PickerOption[] = values.map((o) => ({ value: o, label: o }));
          if (slot) opts = slotOptions(slot, opts);
          const key = paramKeyFor(output?.action ?? "");
          const current = output?.params[key];
          return (
            <TokenPicker
              anchor={anchor}
              title={slot ? `${action?.paramLabel ?? "Value"} — you wrote "${slot.heard}"` : action?.paramLabel ?? "Value"}
              options={opts}
              value={current !== undefined ? (scopeInstanceId(current) ?? scopeLabel(current)) : undefined}
              freeText={!isEnum}
              freeTextPlaceholder={`Enter ${action?.paramLabel ?? "value"}…`}
              scoped={scoped}
              onSelectScope={(ref) => {
                updateActionAt(open.lane, open.i, { params: { [key]: ref } });
                if (slot) onResolve?.(slot);
                close();
              }}
              onSelect={(v) => {
                updateActionAt(open.lane, open.i, { params: { [key]: v } });
                if (slot) onResolve?.(slot);
                close();
              }}
              onClose={close}
            />
          );
        })()}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Controls panel                                                             */
/* -------------------------------------------------------------------------- */

function ControlsPanel({ controls, onChange }: { controls: RuleControls; onChange: (patch: Partial<RuleControls>) => void }) {
  const row = "flex items-center justify-between gap-3 py-1.5";
  const labelCls = "text-sm";
  return (
    <div
      className="animate-popin mt-2 max-w-[420px] rounded-2xl border p-4"
      style={{ borderColor: "var(--panel-border)", background: "var(--panel-solid)" }}
    >
      <div className="mb-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--fg-subtle)" }}>
        Safety controls
      </div>

      <div className={row}>
        <span className={labelCls} style={{ color: "var(--fg)" }}>Mode</span>
        <div className="inline-flex overflow-hidden rounded-lg border" style={{ borderColor: "var(--panel-border)" }}>
          {(["shadow", "armed"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ mode: m })}
              className="px-3 py-1 text-xs font-semibold capitalize transition-colors"
              style={
                controls.mode === m
                  ? { background: "var(--accent)", color: "#fff" }
                  : { background: "transparent", color: "var(--fg-muted)" }
              }
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-1 text-[11px]" style={{ color: "var(--fg-subtle)" }}>
        Shadow observes and logs without acting; Armed dispatches actions.
      </p>

      <div className={row}>
        <span className={labelCls} style={{ color: "var(--fg)" }}>Once per request</span>
        <input
          type="checkbox"
          checked={controls.oncePerRequest}
          onChange={(e) => onChange({ oncePerRequest: e.target.checked })}
          className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
        />
      </div>

      <div className={row}>
        <span className={labelCls} style={{ color: "var(--fg)" }}>Max fires / hour</span>
        <input
          type="number"
          min={1}
          value={controls.maxFiresPerHour}
          onChange={(e) => onChange({ maxFiresPerHour: Math.max(1, Number(e.target.value) || 1) })}
          className="ring-accent w-20 rounded-lg border px-2 py-1 text-sm"
          style={{ borderColor: "var(--panel-border)", background: "var(--panel)", color: "var(--fg)" }}
        />
      </div>

      <div className={row}>
        <span className={labelCls} style={{ color: "var(--fg)" }}>Missing data</span>
        <select
          value={controls.missingData}
          onChange={(e) => onChange({ missingData: e.target.value as RuleControls["missingData"] })}
          className="ring-accent rounded-lg border px-2 py-1 text-sm"
          style={{ borderColor: "var(--panel-border)", background: "var(--panel)", color: "var(--fg)" }}
        >
          <option value="no_match">Treat as no-match</option>
          <option value="alert">Alert (fail-closed)</option>
        </select>
      </div>

      <div className={row}>
        <span className={labelCls} style={{ color: "var(--fg)" }}>Priority</span>
        <input
          type="number"
          value={controls.priority}
          onChange={(e) => onChange({ priority: Number(e.target.value) || 0 })}
          className="ring-accent w-20 rounded-lg border px-2 py-1 text-sm"
          style={{ borderColor: "var(--panel-border)", background: "var(--panel)", color: "var(--fg)" }}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tree pruning when triggers change (attribute leaves outside the new set)   */
/* -------------------------------------------------------------------------- */

function pruneGroup(g: ConditionGroup, allowed: Set<string>, allowFF: boolean): ConditionGroup {
  const children: ConditionNode[] = [];
  for (const ch of g.children) {
    if (isGroup(ch)) {
      children.push(pruneGroup(ch, allowed, allowFF));
    } else {
      const keep = isFormFieldRef(ch.field) ? allowFF : allowed.has(ch.field as string);
      if (keep) children.push(ch);
    }
  }
  return { ...g, children };
}
