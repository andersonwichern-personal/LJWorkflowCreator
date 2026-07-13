"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  WorkflowRule,
  emptyRule,
  ruleUsesUnconfirmed,
  getEvent,
  getAction,
  FIELDS,
  opLabel,
  paramKeyFor,
  STARTER_TEMPLATES,
} from "@/lib/vocabulary";
import {
  WorkflowRecord,
  listWorkflows,
  createWorkflow,
  updateWorkflow,
  toggleWorkflow,
  deleteWorkflow,
} from "@/lib/api";
import RuleSentence from "@/components/RuleSentence";
import ChatBox from "@/components/ChatBox";
import WorkflowSidebar from "@/components/WorkflowSidebar";
import ThemeToggle from "@/components/ThemeToggle";

type Toast = { id: number; kind: "ok" | "err"; text: string };

export default function Page() {
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

  function loadIntoEditor(wf: WorkflowRecord) {
    setActiveId(wf.id);
    setName(wf.name);
    setDescription(wf.description ?? "");
    setRule(normalizeRule(wf.ruleJson));
    setEnabled(wf.enabled);
    setDirty(false);
  }

  function newWorkflow() {
    setActiveId(null);
    setName("Untitled workflow");
    setDescription("");
    setRule(emptyRule());
    setEnabled(true);
    setDirty(false);
  }

  function applyStarter(name: string, description: string, rule: WorkflowRule) {
    setActiveId(null);
    setName(name);
    setDescription(description);
    setRule(rule);
    setEnabled(true);
    setDirty(true);
    pushToast("ok", "Template loaded — tweak the tokens and save.");
  }

  function onRuleChange(next: WorkflowRule) {
    setRule(next);
    setDirty(true);
  }
  function onDraftFromChat(next: WorkflowRule) {
    setRule(next);
    setDirty(true);
    pushToast("ok", "Drafted from your instruction — review the tokens below.");
  }

  async function save() {
    if (!name.trim()) return pushToast("err", "Give the workflow a name first.");
    if (rule.outputs.length === 0) return pushToast("err", "Add at least one action (THEN) before saving.");
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
  const isBlank = !activeId && rule.conds.length === 0 && rule.outputs.length === 0;

  return (
    <div className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="mx-auto mb-6 flex max-w-[1280px] items-center justify-between">
        <div className="flex items-center gap-3.5">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-2xl text-xl font-bold text-white shadow-lg"
            style={{ background: "linear-gradient(135deg, var(--accent), #a855f7)" }}
          >
            ⚡
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-tight tracking-tight" style={{ color: "var(--fg)" }}>
              Workflow Creator
            </h1>
            <p className="text-[13px]" style={{ color: "var(--fg-subtle)" }}>
              Automate loan origination — in plain English.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="hidden rounded-full px-3 py-1.5 text-xs font-medium sm:inline-flex"
            style={{ background: "var(--panel)", border: "1px solid var(--panel-border)", color: "var(--fg-muted)" }}
          >
            {enabledCount} enabled · {workflows.length} total
          </span>
          <ThemeToggle />
        </div>
      </header>

      {/* Body */}
      <div className="mx-auto grid max-w-[1280px] grid-cols-1 gap-5 lg:grid-cols-[290px_1fr]">
        {/* Sidebar */}
        <div className="lg:sticky lg:top-5 lg:h-[calc(100vh-120px)]">
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

        {/* Designer canvas */}
        <main className="animate-rise flex flex-col gap-5">
          {/* Meta row */}
          <div className="glass rounded-2xl p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1">
                <input
                  value={name}
                  onChange={(e) => { setName(e.target.value); setDirty(true); }}
                  placeholder="Workflow name"
                  className="ring-accent w-full rounded-lg bg-transparent px-1 py-0.5 text-2xl font-semibold tracking-tight outline-none"
                  style={{ color: "var(--fg)" }}
                />
                <input
                  value={description}
                  onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
                  placeholder="Add a short description…"
                  className="ring-accent mt-1 w-full rounded-lg bg-transparent px-1 py-0.5 text-sm outline-none"
                  style={{ color: "var(--fg-muted)" }}
                />
              </div>
              <div className="flex items-center gap-3">
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
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="ring-accent rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
                  style={{ background: "var(--accent)" }}
                >
                  {saving ? "Saving…" : activeId ? "Update" : "Save workflow"}
                </button>
              </div>
            </div>
          </div>

          {/* Starter templates (only on a blank new workflow) */}
          {isBlank && (
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
                    className="ring-accent group flex items-start gap-3 rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                    style={{ borderColor: "var(--panel-border)", background: "var(--panel-solid)" }}
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
                      style={{ background: "var(--accent-soft)" }}
                    >
                      {t.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold" style={{ color: "var(--fg)" }}>
                        {t.name}
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug" style={{ color: "var(--fg-muted)" }}>
                        {t.description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Rule sentence */}
          <div className="glass rounded-2xl p-6">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--fg-subtle)" }}>
                Rule builder
              </h3>
              {ev(rule) && (
                <span className="hidden max-w-[46ch] truncate text-xs sm:block" style={{ color: "var(--fg-subtle)" }}>
                  {ev(rule)}
                </span>
              )}
            </div>

            <RuleSentence rule={rule} onChange={onRuleChange} />

            {/* Live plain-English readout */}
            <div className="mt-6 rounded-xl p-4" style={{ background: "var(--panel-solid)", border: "1px solid var(--panel-border)" }}>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--fg-subtle)" }}>
                Reads as
              </div>
              <p className="text-[15px] leading-relaxed" style={{ color: "var(--fg)" }}>
                {summary}
              </p>
            </div>

            {unconfirmed && (
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

          {/* Chat drafting */}
          <ChatBox onDraft={onDraftFromChat} />

          {/* Rule JSON */}
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
        </main>
      </div>

      {/* Toasts */}
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

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

let _tid = 0;
function toastId(): number {
  return ++_tid;
}
function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}
function ev(rule: WorkflowRule): string | undefined {
  return getEvent(rule.event)?.blurb;
}

function normalizeRule(raw: WorkflowRule | undefined): WorkflowRule {
  if (!raw) return emptyRule();
  return {
    event: raw.event ?? emptyRule().event,
    conds: Array.isArray(raw.conds) ? raw.conds : [],
    outputs: Array.isArray(raw.outputs) ? raw.outputs : [],
    condLogic: raw.condLogic === "OR" ? "OR" : "AND",
  };
}

function plainSummary(rule: WorkflowRule): string {
  const evLabel = getEvent(rule.event)?.label ?? rule.event;
  let s = `When ${evLabel} fires`;
  if (rule.conds.length) {
    const parts = rule.conds.map((c) => {
      const field = FIELDS[c.field];
      const label = field?.label ?? c.field;
      const op = opLabel(field?.kind ?? "text", c.operator);
      let val = c.value || "…";
      if (field?.kind === "numeric" && c.value && !isNaN(Number(c.value))) {
        val = `${field.unit ?? ""}${Number(c.value).toLocaleString("en-US")}`;
      }
      return `${label} ${op} ${val}`;
    });
    s += ` and ${parts.join(` ${rule.condLogic.toLowerCase()} `)}`;
  }
  if (rule.outputs.length) {
    const parts = rule.outputs.map((o) => {
      const action = getAction(o.action);
      const label = action?.label ?? o.action;
      if (action?.paramKind === "none") return label;
      const val = o.params[paramKeyFor(o.action)] || "…";
      return `${label} ${val}`;
    });
    s += `, then ${parts.join(" and ")}`;
  } else {
    s += ", then … (add an action)";
  }
  return s + ".";
}
