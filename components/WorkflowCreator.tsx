"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  WorkflowRule,
  RuleOutput,
  ConditionGroup,
  emptyRule,
  normalizeRule,
  ruleUsesUnconfirmed,
  getEvent,
  getAction,
  opLabel,
  paramKeyFor,
  STARTER_TEMPLATES,
  condFieldLabel,
  condFieldKind,
  condFieldDef,
  isValuelessOperator,
  isLegacyString,
  scopeLabel,
  isGroup,
  walkLeaves,
  ASSIGNEES,
} from "@/lib/vocabulary";
import { UnresolvedSlot } from "@/lib/nlParser";
import { ChatDraftMeta } from "@/components/ChatBox";
import {
  WorkflowRecord,
  listWorkflows,
  createWorkflow,
  updateWorkflow,
  toggleWorkflow,
  deleteWorkflow,
  listAuthorities,
} from "@/lib/api";
import RuleSentence from "@/components/RuleSentence";
import ChatBox from "@/components/ChatBox";
import WorkflowSidebar from "@/components/WorkflowSidebar";
import SimulationPanel from "@/components/SimulationPanel";
import PageHeader from "@/components/ui/PageHeader";
import Toggle from "@/components/Toggle";
import {
  VocabularySource,
  buildOverlay,
  emptyInstances,
  describeSource,
  loadLiveVocabulary,
} from "@/lib/liveVocabulary";
import { useViewpoint } from "@/lib/viewpoint";

type Toast = { id: number; kind: "ok" | "err"; text: string };

export default function WorkflowCreator() {
  // Phase 3 viewpoints: only the Admin persona edits the canvas; Presentation
  // view hides the dev surface (simulation traces, lint warnings, raw JSON).
  const { persona, canEdit, isPresentation } = useViewpoint();
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState("Untitled workflow");
  const [description, setDescription] = useState("");
  const [rule, setRule] = useState<WorkflowRule>(emptyRule());
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);

  // Demo bridge: live platform vocabulary for the pickers (falls back to static).
  const [vocabSource, setVocabSource] = useState<VocabularySource | null>(null);
  useEffect(() => {
    loadLiveVocabulary().then(setVocabSource);
  }, []);

  // Configured approval-authority levels feed the `escalate to authority` action
  // — both as label options and as ID-bearing instances for the scoped picker.
  const [authorities, setAuthorities] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    listAuthorities()
      .then((list) => setAuthorities(list.map((a) => ({ id: a.id, label: a.name }))))
      .catch(() => setAuthorities([])); // static paramOptions remain the fallback
  }, []);

  const overlay = useMemo(() => {
    const base = buildOverlay(vocabSource);
    if (!authorities.length) return base;
    return {
      fieldOptions: base?.fieldOptions ?? {},
      actionParamOptions: { ...base?.actionParamOptions, assign_authority: authorities.map((a) => a.label) },
      liveFields: base?.liveFields ?? [],
      instances: { ...(base?.instances ?? emptyInstances()), authorities },
    };
  }, [vocabSource, authorities]);

  const pushToast = useCallback((kind: Toast["kind"], text: string) => {
    const id = toastId();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const refresh = useCallback(async () => {
    setLoadingList(true);
    try {
      setWorkflows(await listWorkflows());
    } catch (e: unknown) {
      pushToast("err", errMsg(e, "Couldn't load workflows"));
    } finally {
      setLoadingList(false);
    }
  }, [pushToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Parser slots that still need a human pick (N1) — saving is blocked until empty.
  const [unresolved, setUnresolved] = useState<UnresolvedSlot[]>([]);

  function loadIntoEditor(wf: WorkflowRecord) {
    setActiveId(wf.id);
    setName(wf.name);
    setDescription(wf.description ?? "");
    setRule(normalizeRule(wf.ruleJson));
    setEnabled(wf.enabled);
    setDirty(false);
    setUnresolved([]);
  }

  function newWorkflow() {
    setActiveId(null);
    setName("Untitled workflow");
    setDescription("");
    setRule(emptyRule());
    setEnabled(true);
    setDirty(false);
    setUnresolved([]);
  }

  function applyStarter(n: string, d: string, r: WorkflowRule) {
    setActiveId(null);
    setName(n);
    setDescription(d);
    setRule(r);
    setEnabled(true);
    setDirty(true);
    setUnresolved([]);
    pushToast("ok", "Template loaded — tweak the tokens and save.");
  }

  function onRuleChange(next: WorkflowRule) {
    setRule(next);
    setDirty(true);
    // Re-validate slots against the edited rule: a slot survives only while its
    // target still exists and still lacks a value (deleting the token or
    // filling it manually must unblock save — indexes shift on removal).
    setUnresolved((u) => {
      const leaves = walkLeaves(next.conditions);
      return u.filter((s) => {
        if (s.where === "condition-value") {
          const c = leaves[s.conditionIndex ?? -1];
          return !!c && !c.value && !isValuelessOperator(c.operator);
        }
        if (s.where === "action-param") {
          const actions = s.lane === "else" ? next.else ?? [] : next.actions;
          const a = actions[s.actionIndex ?? -1];
          return !!a && !a.params[s.param ?? ""];
        }
        return true;
      });
    });
  }
  function onDraftFromChat(next: WorkflowRule, meta: ChatDraftMeta) {
    setRule(next);
    setDirty(true);
    setUnresolved(meta.unresolved);
    pushToast(
      meta.unresolved.length ? "err" : "ok",
      meta.unresolved.length
        ? "Drafted — resolve the highlighted values before saving."
        : "Drafted from your instruction — review the tokens below."
    );
  }

  async function save() {
    if (!canEdit) {
      return pushToast("err", `${persona.name} (${persona.roleLabel}) has read-only access — switch to the Admin viewpoint to edit.`);
    }
    if (!name.trim()) return pushToast("err", "Give the workflow a name first.");
    // N1 hard gate: unresolved parser slots must be picked before persistence.
    if (unresolved.length > 0) {
      return pushToast("err", "Resolve the highlighted values before saving.");
    }
    // Armed rules must act; shadow rules may observe action-less (§3.5).
    if (rule.controls.mode === "armed" && rule.actions.length === 0) {
      return pushToast("err", "Add at least one action, or switch the rule to shadow mode to observe.");
    }
    setSaving(true);
    try {
      if (activeId) {
        const updated = await updateWorkflow(activeId, {
          name: name.trim(),
          description: description.trim() || null,
          ruleJson: rule,
          enabled,
        });
        pushToast("ok", "Workflow updated.");
        setWorkflows((list) => list.map((w) => (w.id === updated.id ? updated : w)));
      } else {
        const created = await createWorkflow({
          name: name.trim(),
          description: description.trim() || undefined,
          ruleJson: rule,
          enabled,
        });
        pushToast("ok", "Workflow saved.");
        setActiveId(created.id);
        setWorkflows((list) => [created, ...list]);
      }
      setDirty(false);
    } catch (e: unknown) {
      pushToast("err", errMsg(e, "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  async function onToggleWorkflow(wf: WorkflowRecord, next: boolean) {
    if (!canEdit) {
      return pushToast("err", `${persona.name} (${persona.roleLabel}) has read-only access — switch to the Admin viewpoint to edit.`);
    }
    setWorkflows((list) => list.map((w) => (w.id === wf.id ? { ...w, enabled: next } : w)));
    if (wf.id === activeId) setEnabled(next);
    try {
      await toggleWorkflow(wf.id, next);
    } catch (e: unknown) {
      setWorkflows((list) => list.map((w) => (w.id === wf.id ? { ...w, enabled: !next } : w)));
      pushToast("err", errMsg(e, "Toggle failed"));
    }
  }

  async function onDeleteWorkflow(wf: WorkflowRecord) {
    if (!canEdit) {
      return pushToast("err", `${persona.name} (${persona.roleLabel}) has read-only access — switch to the Admin viewpoint to edit.`);
    }
    if (!confirm(`Delete “${wf.name}”? This can't be undone.`)) return;
    try {
      await deleteWorkflow(wf.id);
      setWorkflows((list) => list.filter((w) => w.id !== wf.id));
      if (wf.id === activeId) newWorkflow();
      pushToast("ok", "Workflow deleted.");
    } catch (e: unknown) {
      pushToast("err", errMsg(e, "Delete failed"));
    }
  }

  const summary = useMemo(() => plainSummary(rule), [rule]);
  const unconfirmed = useMemo(() => ruleUsesUnconfirmed(rule), [rule]);
  const enabledCount = workflows.filter((w) => w.enabled).length;
  const isBlank = !activeId && rule.conditions.children.length === 0 && rule.actions.length === 0;

  return (
    <div>
      <PageHeader
        title="Workflows"
        icon="⚡"
        actions={
          <>
            <span
              title={describeSource(vocabSource)}
              className="rounded-full px-3 py-1.5 text-xs font-medium"
              style={
                vocabSource?.source === "live"
                  ? { background: "var(--tok-if-bg)", color: "var(--tok-if-fg)" }
                  : {
                      background: "var(--panel)",
                      border: "1px solid var(--panel-border)",
                      color: "var(--fg-subtle)",
                    }
              }
            >
              {vocabSource?.source === "live" ? "● Live vocabulary" : "○ Demo vocabulary"}
            </span>
            <span
              className="rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ background: "var(--panel)", border: "1px solid var(--panel-border)", color: "var(--fg-muted)" }}
            >
              {enabledCount} enabled · {workflows.length} total
            </span>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        {/* Saved workflows */}
        <div className="lg:sticky lg:top-[84px] lg:h-[calc(100vh-160px)]">
          <WorkflowSidebar
            workflows={workflows}
            activeId={activeId}
            loading={loadingList}
            onSelect={loadIntoEditor}
            onNew={newWorkflow}
            onToggle={onToggleWorkflow}
            onDelete={onDeleteWorkflow}
          />
        </div>

        {/* Designer canvas — hierarchy: title bar → AI console → tokens → simulation */}
        <div className="flex flex-col gap-5">
          {/* 1. Workflow Title Bar — anchors what rule you are editing */}
          <div className="glass rounded-2xl p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1">
                <input
                  value={name}
                  disabled={!canEdit}
                  onChange={(e) => { setName(e.target.value); setDirty(true); }}
                  placeholder="Workflow name"
                  className="ring-accent w-full rounded-lg bg-transparent px-1 py-0.5 text-2xl font-semibold tracking-tight outline-none disabled:opacity-70"
                  style={{ color: "var(--fg)" }}
                />
                <input
                  value={description}
                  disabled={!canEdit}
                  onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
                  placeholder="Add a short description…"
                  className="ring-accent mt-1 w-full rounded-lg bg-transparent px-1 py-0.5 text-sm outline-none disabled:opacity-70"
                  style={{ color: "var(--fg-muted)" }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {!canEdit && (
                  <span
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                    style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }}
                    title={`${persona.name} (${persona.roleLabel}) can view the canvas but not change it.`}
                  >
                    Read-only — {persona.roleLabel} view
                  </span>
                )}
                <span className="flex items-center gap-2">
                  <Toggle
                    size="sm"
                    checked={enabled}
                    disabled={!canEdit}
                    onChange={(v) => { setEnabled(v); setDirty(true); }}
                    label="Workflow enabled"
                  />
                  <span className="text-xs font-medium" style={{ color: "var(--fg-muted)" }}>
                    {enabled ? "Enabled" : "Off"}
                  </span>
                </span>
                {(activeId || dirty) && (
                  <span
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                    style={{
                      background: dirty ? "var(--warn-bg)" : "var(--tok-if-bg)",
                      color: dirty ? "var(--warn-fg)" : "var(--tok-if-fg)",
                    }}
                  >
                    {dirty ? "Unsaved changes" : "Saved"}
                  </span>
                )}
                {canEdit && (
                  <>
                    <button
                      type="button"
                      onClick={newWorkflow}
                      className="ring-accent rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-[var(--accent-soft)]"
                      style={{ borderColor: "var(--panel-border)", color: "var(--fg-muted)" }}
                    >
                      New
                    </button>
                    {activeId && (
                      <button
                        type="button"
                        onClick={() => {
                          const wf = workflows.find((w) => w.id === activeId);
                          if (wf) onDeleteWorkflow(wf);
                        }}
                        className="ring-accent rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-[var(--danger-bg)]"
                        style={{ borderColor: "var(--panel-border)", color: "var(--danger-fg)" }}
                      >
                        Delete
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={save}
                      disabled={saving}
                      className="ring-accent rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
                      style={{ background: "var(--accent)" }}
                    >
                      {saving ? "Saving…" : activeId ? "Update" : "Save workflow"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 2. Focal AI console — parser resolves against the live vocabulary */}
          {canEdit && (
            <ChatBox
              onDraft={onDraftFromChat}
              parserOptions={{
                assignees: overlay?.actionParamOptions.assign_user ?? ASSIGNEES,
                instanceOptions: overlay?.fieldOptions,
                // Phase 2 §4.6: id-bearing registries → parser emits instance ScopeRefs.
                instanceRegistry: overlay
                  ? {
                      team_member: overlay.instances.users,
                      retailer: overlay.instances.retailers,
                      template: overlay.instances.templates,
                      assign_user: overlay.instances.users,
                      notify: overlay.instances.users,
                      assign_authority: overlay.instances.authorities,
                    }
                  : undefined,
              }}
            />
          )}

          {isBlank && canEdit && (
            <div className="glass rounded-2xl p-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--fg-subtle)" }}>
                Start from a template
              </h3>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {STARTER_TEMPLATES.map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => applyStarter(t.name, t.description, structuredClone(t.rule))}
                    className="ring-accent group flex items-center gap-3 rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                    style={{ borderColor: "var(--panel-border)", background: "var(--panel-solid)" }}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg" style={{ background: "var(--accent-soft)" }}>
                      {t.icon}
                    </span>
                    <span className="min-w-0 truncate text-sm font-semibold" style={{ color: "var(--fg)" }}>{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="glass rounded-2xl p-6">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--fg-subtle)" }}>
                Rule builder
              </h3>
            </div>

            {/* Read-only viewpoints get a frozen (non-interactive) canvas. */}
            <div
              className={canEdit ? undefined : "pointer-events-none select-none opacity-80"}
              aria-disabled={!canEdit}
            >
              <RuleSentence
                rule={rule}
                onChange={onRuleChange}
                overlay={overlay}
                unresolved={unresolved}
                onResolve={(slot) => setUnresolved((u) => u.filter((s) => s !== slot))}
              />
            </div>

            <div className="mt-6 rounded-xl p-4" style={{ background: "var(--panel-solid)", border: "1px solid var(--panel-border)" }}>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--fg-subtle)" }}>
                Reads as
              </div>
              <p className="text-[15px] leading-relaxed" style={{ color: "var(--fg)" }}>{summary}</p>
            </div>

            {unconfirmed && !isPresentation && (
              <div
                className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs"
                style={{ background: "var(--warn-bg)", color: "var(--warn-fg)", border: "1px solid var(--warn-br)" }}
              >
                <span aria-hidden>⚠</span>
                <span>
                  This rule uses vocabulary that isn&apos;t yet confirmed against the live platform.
                  It will save, but the engine may not be able to emit or execute it.
                </span>
              </div>
            )}
          </div>

          {/* Builder-only dev surface: simulation traces + persisted contract */}
          {!isPresentation && <SimulationPanel rule={rule} workflowId={activeId} />}

          {!isPresentation && (
            <details className="glass rounded-2xl p-4">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--fg-subtle)" }}>
                Rule JSON (persisted contract)
              </summary>
              <pre
                className="scroll-thin mt-3 overflow-x-auto rounded-xl p-3 text-xs"
                style={{ background: "var(--panel-solid)", color: "var(--fg-muted)", border: "1px solid var(--panel-border)" }}
              >
                {JSON.stringify(rule, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>

      <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-popin glass rounded-xl px-4 py-2.5 text-sm shadow-lg"
            style={{ color: "var(--fg)", borderLeft: `3px solid ${t.kind === "ok" ? "var(--accent)" : "var(--warn-fg)"}` }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/* helpers */
let _tid = 0;
function toastId(): number {
  return ++_tid;
}
function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}
function summarizeLeaf(c: ReturnType<typeof walkLeaves>[number]): string {
  const label = condFieldLabel(c.field);
  const kind = condFieldKind(c.field);
  const op = opLabel(kind, c.operator);
  if (isValuelessOperator(c.operator)) return `${label} ${op}`;
  let val = scopeLabel(c.value) || "…";
  if (kind === "numeric" && isLegacyString(c.value) && c.value && !isNaN(Number(c.value))) {
    val = `${condFieldDef(c.field)?.unit ?? ""}${Number(c.value).toLocaleString("en-US")}`;
  }
  return `${label} ${op} ${val}`;
}

function summarizeGroup(group: ConditionGroup): string {
  return group.children
    .map((child) => (isGroup(child) ? `(${summarizeGroup(child)})` : summarizeLeaf(child)))
    .join(` ${group.logic.toLowerCase()} `);
}

function describeActionList(list: RuleOutput[]): string {
  return list
    .map((o) => {
      const action = getAction(o.action);
      const label = action?.label ?? o.action;
      if (action?.paramKind === "none") return label;
      const val = scopeLabel(o.params[paramKeyFor(o.action)]) || "…";
      return `${label} ${val}`;
    })
    .join(" and ");
}

function plainSummary(rule: WorkflowRule): string {
  const evLabels = rule.triggers.map((t) => getEvent(t.event)?.label ?? t.event);
  let s = `When ${evLabels.join(" or ")} fires`;
  if (rule.conditions.children.length) {
    s += `, if ${summarizeGroup(rule.conditions)}`;
  }
  if (rule.actions.length) {
    s += `, then ${describeActionList(rule.actions)}`;
  } else if (rule.controls.mode === "armed") {
    s += ", then … (add an action)";
  } else {
    s += " (observing)";
  }
  if (rule.else && rule.else.length) {
    s += `; otherwise ${describeActionList(rule.else)}`;
  }
  s += ".";
  if (rule.controls.mode === "shadow") s += " [shadow]";
  return s;
}
