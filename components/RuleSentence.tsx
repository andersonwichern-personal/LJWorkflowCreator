"use client";

import { useState } from "react";
import {
  WorkflowRule,
  EVENTS,
  FIELDS,
  FIELD_GROUPS,
  ACTIONS,
  OPERATORS,
  getEvent,
  getAction,
  allowedFieldsForEvent,
  opLabel,
  paramKeyFor,
  defaultValueFor,
  defaultParamFor,
  RuleCondition,
  RuleOutput,
} from "@/lib/vocabulary";
import TokenPicker, { PickerOption } from "./TokenPicker";

type Open =
  | { kind: "event" }
  | { kind: "cond-field"; i: number }
  | { kind: "cond-op"; i: number }
  | { kind: "cond-value"; i: number }
  | { kind: "action"; i: number }
  | { kind: "action-param"; i: number }
  | { kind: "add-cond" }
  | { kind: "add-action" };

type Palette = "when" | "if" | "then" | "op";

function paletteStyle(p: Palette): React.CSSProperties {
  if (p === "op") return { background: "var(--tok-op-bg)", color: "var(--tok-op-fg)", borderColor: "transparent" };
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
  const field = FIELDS[c.field];
  if (!c.value) return "value";
  if (field?.kind === "numeric") {
    const n = Number(c.value);
    const formatted = isNaN(n) ? c.value : n.toLocaleString("en-US");
    return `${field.unit ?? ""}${formatted}`;
  }
  return c.value;
}

/** Build grouped field options for the picker. */
function fieldOptionsFor(eventKey: string): PickerOption[] {
  const groupIcon = (g: string) => FIELD_GROUPS.find((x) => x.key === g)?.icon;
  return allowedFieldsForEvent(eventKey)
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
}

interface RuleSentenceProps {
  rule: WorkflowRule;
  onChange: (rule: WorkflowRule) => void;
}

export default function RuleSentence({ rule, onChange }: RuleSentenceProps) {
  const [open, setOpen] = useState<Open | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  function openPicker(state: Open, el: HTMLElement) {
    setOpen(state);
    setAnchor(el);
  }
  function close() {
    setOpen(null);
    setAnchor(null);
  }

  // Convenience accessors into the versioned (v2) rule shape.
  const eventKey = rule.trigger.event;
  const conds = rule.conditions.rules;
  const logic = rule.conditions.logic;
  const actions = rule.actions;

  /* ---- mutators ---- */
  function setEvent(newEvent: string) {
    const allowed = new Set(allowedFieldsForEvent(newEvent).map((f) => f.key));
    onChange({
      ...rule,
      trigger: { event: newEvent },
      conditions: { ...rule.conditions, rules: conds.filter((c) => allowed.has(c.field)) },
    });
  }
  function addCondition(fieldKey: string) {
    const field = FIELDS[fieldKey];
    onChange({
      ...rule,
      conditions: {
        ...rule.conditions,
        rules: [...conds, { field: fieldKey, operator: OPERATORS[field.kind][0].value, value: defaultValueFor(field) }],
      },
    });
  }
  function updateCond(i: number, patch: Partial<RuleCondition>) {
    onChange({ ...rule, conditions: { ...rule.conditions, rules: conds.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) } });
  }
  function removeCond(i: number) {
    onChange({ ...rule, conditions: { ...rule.conditions, rules: conds.filter((_, idx) => idx !== i) } });
  }
  function toggleLogic() {
    onChange({ ...rule, conditions: { ...rule.conditions, logic: logic === "AND" ? "OR" : "AND" } });
  }
  function addAction(actionKey: string) {
    const action = getAction(actionKey)!;
    onChange({ ...rule, actions: [...actions, { action: actionKey, params: defaultParamFor(action) }] });
  }
  function updateAction(i: number, patch: Partial<RuleOutput>) {
    onChange({ ...rule, actions: actions.map((o, idx) => (idx === i ? { ...o, ...patch } : o)) });
  }
  function removeAction(i: number) {
    onChange({ ...rule, actions: actions.filter((_, idx) => idx !== i) });
  }

  /* ---- option builders ---- */
  const eventOptions: PickerOption[] = EVENTS.map((e) => ({
    value: e.key,
    label: e.label,
    confidence: e.confidence,
    hint: e.blurb,
  }));
  const fieldOptions = fieldOptionsFor(eventKey);
  const actionOptions: PickerOption[] = ACTIONS.map((a) => ({
    value: a.key,
    label: a.label,
    confidence: a.confidence,
    hint: a.blurb,
  }));

  const ev = getEvent(eventKey);

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3 leading-relaxed" style={{ color: "var(--fg)" }}>
        {/* WHEN */}
        <Word>When</Word>
        <Pill palette="when" unconfirmed={ev?.confidence === "unconfirmed"} onClick={(el) => openPicker({ kind: "event" }, el)}>
          {ev?.label ?? "select event"}
        </Pill>

        {/* IF */}
        {conds.length > 0 && <Word>If</Word>}
        {conds.map((c, i) => {
          const field = FIELDS[c.field];
          return (
            <span key={i} className="inline-flex flex-wrap items-center gap-2">
              {i > 0 && (
                <Pill palette="op" onClick={() => toggleLogic()}>
                  {logic}
                </Pill>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full border px-1 py-0.5" style={{ borderColor: "var(--tok-if-br)" }}>
                <Pill palette="if" unconfirmed={field?.confidence === "unconfirmed"} onClick={(el) => openPicker({ kind: "cond-field", i }, el)}>
                  {field?.label ?? c.field}
                </Pill>
                <button
                  type="button"
                  onClick={(e) => openPicker({ kind: "cond-op", i }, e.currentTarget)}
                  className="ring-accent rounded-md px-1 text-[13px] font-medium lowercase transition-colors hover:bg-[var(--accent-soft)]"
                  style={{ color: "var(--fg-muted)" }}
                >
                  {opLabel(field?.kind ?? "text", c.operator)}
                </button>
                <Pill palette="if" onClick={(el) => openPicker({ kind: "cond-value", i }, el)}>
                  {displayValue(c)}
                </Pill>
                <button
                  type="button"
                  onClick={() => removeCond(i)}
                  aria-label="Remove condition"
                  className="ring-accent mr-0.5 flex h-5 w-5 items-center justify-center rounded-full text-xs transition-colors hover:bg-[var(--accent-soft)]"
                  style={{ color: "var(--fg-subtle)" }}
                >
                  ×
                </button>
              </span>
            </span>
          );
        })}
        <Pill palette="if" dashed onClick={(el) => openPicker({ kind: "add-cond" }, el)}>
          {conds.length ? "+ and" : "+ add condition"}
        </Pill>

        {/* THEN */}
        <Word>Then</Word>
        {actions.map((o, i) => {
          const action = getAction(o.action);
          const key = paramKeyFor(o.action);
          const paramVal = o.params[key] ?? "";
          const hasParam = action?.paramKind !== "none";
          return (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border px-1 py-0.5" style={{ borderColor: "var(--tok-then-br)" }}>
                <Pill palette="then" unconfirmed={action?.confidence === "unconfirmed"} onClick={(el) => openPicker({ kind: "action", i }, el)}>
                  {action?.label ?? o.action}
                </Pill>
                {hasParam && (
                  <Pill palette="then" onClick={(el) => openPicker({ kind: "action-param", i }, el)}>
                    {paramVal || action?.paramLabel || "value"}
                  </Pill>
                )}
                <button
                  type="button"
                  onClick={() => removeAction(i)}
                  aria-label="Remove action"
                  className="ring-accent mr-0.5 flex h-5 w-5 items-center justify-center rounded-full text-xs transition-colors hover:bg-[var(--accent-soft)]"
                  style={{ color: "var(--fg-subtle)" }}
                >
                  ×
                </button>
              </span>
            </span>
          );
        })}
        <Pill palette="then" dashed onClick={(el) => openPicker({ kind: "add-action" }, el)}>
          {actions.length ? "+ action" : "+ add action"}
        </Pill>
      </div>

      {/* Pickers */}
      {open?.kind === "event" && (
        <TokenPicker anchor={anchor} title="Trigger event" options={eventOptions} value={eventKey} onSelect={(v) => { setEvent(v); close(); }} onClose={close} />
      )}

      {open?.kind === "add-cond" && (
        <TokenPicker anchor={anchor} title={`Conditions for ${eventKey}`} options={fieldOptions} onSelect={(v) => { addCondition(v); close(); }} onClose={close} />
      )}

      {open?.kind === "cond-field" && (
        <TokenPicker
          anchor={anchor}
          title="Condition field"
          options={fieldOptions}
          value={conds[open.i]?.field}
          onSelect={(v) => {
            const field = FIELDS[v];
            updateCond(open.i, { field: v, operator: OPERATORS[field.kind][0].value, value: defaultValueFor(field) });
            close();
          }}
          onClose={close}
        />
      )}

      {open?.kind === "cond-op" &&
        (() => {
          const field = FIELDS[conds[open.i]?.field];
          const opts: PickerOption[] = OPERATORS[field?.kind ?? "text"].map((o) => ({ value: o.value, label: o.label }));
          return (
            <TokenPicker anchor={anchor} title="Operator" options={opts} value={conds[open.i]?.operator} onSelect={(v) => { updateCond(open.i, { operator: v }); close(); }} onClose={close} />
          );
        })()}

      {open?.kind === "cond-value" &&
        (() => {
          const cond = conds[open.i];
          const field = FIELDS[cond?.field];
          const isEnum = field?.kind === "enum";
          const isNum = field?.kind === "numeric";
          const opts: PickerOption[] = isEnum
            ? (field.options ?? []).map((o) => ({ value: o, label: o }))
            : (field?.options ?? []).map((o) => ({ value: o, label: o }));
          return (
            <TokenPicker
              anchor={anchor}
              title={field?.label ?? "Value"}
              options={opts}
              value={cond?.value}
              freeText={!isEnum}
              numeric={isNum}
              freeTextPlaceholder={isNum ? "Enter an amount…" : `Enter ${field?.label ?? "value"}…`}
              onSelect={(v) => { updateCond(open.i, { value: v }); close(); }}
              onClose={close}
            />
          );
        })()}

      {open?.kind === "action" && (
        <TokenPicker
          anchor={anchor}
          title="Action"
          options={actionOptions}
          value={actions[open.i]?.action}
          onSelect={(v) => { const action = getAction(v)!; updateAction(open.i, { action: v, params: defaultParamFor(action) }); close(); }}
          onClose={close}
        />
      )}

      {open?.kind === "add-action" && (
        <TokenPicker anchor={anchor} title="Add action" options={actionOptions} onSelect={(v) => { addAction(v); close(); }} onClose={close} />
      )}

      {open?.kind === "action-param" &&
        (() => {
          const output = actions[open.i];
          const action = getAction(output?.action);
          const isEnum = action?.paramKind === "enum";
          const opts: PickerOption[] = (action?.paramOptions ?? []).map((o) => ({ value: o, label: o }));
          const key = paramKeyFor(output?.action ?? "");
          return (
            <TokenPicker
              anchor={anchor}
              title={action?.paramLabel ?? "Value"}
              options={opts}
              value={output?.params[key]}
              freeText={!isEnum}
              freeTextPlaceholder={`Enter ${action?.paramLabel ?? "value"}…`}
              onSelect={(v) => { updateAction(open.i, { params: { [key]: v } }); close(); }}
              onClose={close}
            />
          );
        })()}
    </div>
  );
}
