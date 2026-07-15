"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AuthorityRecord,
  AuthorityInput,
  ApprovalTaskRecord,
  listAuthorities,
  createAuthority,
  updateAuthority,
  deleteAuthority,
  listApprovalTasks,
  createApprovalTask,
  recordApprovalDecision,
} from "@/lib/api";
import {
  ApprovalRequirement,
  decideAuthority,
  describeRequirement,
  normalizeRequirement,
  requirementApprovers,
} from "@/lib/authorityEngine";
import { Check, Landmark, X } from "lucide-react";
import { approverIdFor, makerCheckerExclusions, useViewpoint } from "@/lib/viewpoint";
import { formatCurrency, REQUESTS } from "@/lib/platformData";
import PageHeader from "@/components/ui/PageHeader";
import RequirementEditor from "@/components/RequirementEditor";
import Toggle from "@/components/Toggle";

const RISK_GRADES = ["A", "B", "C", "D", "E"];
const PRODUCTS = ["All", "Term Loan", "Line of Credit"];

type Toast = { id: number; kind: "ok" | "err"; text: string };

interface DrawerForm {
  name: string;
  limit: string;
  riskGrade: string;
  product: string;
  autoApprove: boolean;
  escalationId: string;
  requirement: ApprovalRequirement;
}

const EMPTY_FORM: DrawerForm = {
  name: "",
  limit: "",
  riskGrade: "A",
  product: "All",
  autoApprove: false,
  escalationId: "",
  requirement: { type: "any_of", approvers: [] },
};

/** Editing view of a stored level: configured topology, else legacy userIds with resolvable ids. */
function requirementFor(a: AuthorityRecord): ApprovalRequirement {
  if (a.requirement) return normalizeRequirement(a.requirement);
  const roster = Array.isArray(a.userIds) ? a.userIds : [];
  return {
    type: "any_of",
    approvers: roster.map((name) => ({ id: approverIdFor(name), label: name })),
  };
}

/**
 * Approval Authority matrix (Option C): each level maps Amount + Risk Grade +
 * Product to assigned approvers, with optional auto-approval lanes and an
 * escalation target. Levels feed the Rules Canvas `escalate to authority`
 * action dynamically.
 */
export default function ApprovalAuthorities() {
  const { persona, canEdit } = useViewpoint();
  const [authorities, setAuthorities] = useState<AuthorityRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AuthorityRecord | null>(null);
  const [form, setForm] = useState<DrawerForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setAuthorities(await listAuthorities());
    } catch (e: unknown) {
      pushToast("err", e instanceof Error ? e.message : "Couldn't load authorities");
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDrawerOpen(true);
  }

  function openEdit(a: AuthorityRecord) {
    setEditing(a);
    setForm({
      name: a.name,
      limit: String(Number(a.limit)),
      riskGrade: a.riskGrade,
      product: a.product,
      autoApprove: a.autoApprove,
      escalationId: a.escalationId ?? "",
      requirement: requirementFor(a),
    });
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditing(null);
  }

  async function save() {
    if (!form.name.trim()) return pushToast("err", "Give the level a name first.");
    const limit = Number(form.limit);
    if (!form.limit.trim() || !Number.isFinite(limit) || limit < 0) {
      return pushToast("err", "Enter a valid monetary limit.");
    }
    const seats = requirementApprovers(form.requirement);
    if (seats.length === 0) {
      return pushToast("err", "Pick at least one approver for the requirement.");
    }
    const payload: AuthorityInput = {
      name: form.name.trim(),
      limit,
      riskGrade: form.riskGrade,
      product: form.product,
      autoApprove: form.autoApprove,
      escalationId: form.escalationId || null,
      requirement: form.requirement,
      // Legacy mirror: keep userIds in sync so the escalate action + older
      // surfaces keep listing members while requirement becomes the truth.
      userIds: seats.map((s) => s.label),
    };
    setSaving(true);
    try {
      if (editing) {
        const updated = await updateAuthority(editing.id, payload);
        setAuthorities((list) => list.map((a) => (a.id === updated.id ? updated : a)));
        pushToast("ok", "Authority level updated.");
      } else {
        const created = await createAuthority(payload);
        setAuthorities((list) =>
          [...list, created].sort((a, b) => Number(a.limit) - Number(b.limit))
        );
        pushToast("ok", "Authority level created.");
      }
      closeDrawer();
      refresh(); // re-sync escalation names
    } catch (e: unknown) {
      pushToast("err", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing) return;
    if (!confirm(`Delete “${editing.name}”? Levels escalating to it will lose their target.`)) return;
    try {
      await deleteAuthority(editing.id);
      pushToast("ok", "Authority level deleted.");
      closeDrawer();
      refresh();
    } catch (e: unknown) {
      pushToast("err", e instanceof Error ? e.message : "Delete failed");
    }
  }

  const autoCount = authorities.filter((a) => a.autoApprove).length;

  // Matrix decision preview (alignment doc §7) — explain what the matrix decides.
  const [previewAmount, setPreviewAmount] = useState("310000");
  const [previewGrade, setPreviewGrade] = useState("B");
  const [previewProduct, setPreviewProduct] = useState("Term Loan");
  const preview = useMemo(() => {
    const amount = Number(previewAmount);
    if (!previewAmount.trim() || !Number.isFinite(amount) || amount < 0 || authorities.length === 0) {
      return null;
    }
    return decideAuthority({ amount, riskGrade: previewGrade, product: previewProduct }, authorities);
  }, [previewAmount, previewGrade, previewProduct, authorities]);

  // Phase 3: live review tasks (decisions cards) — the server owns evaluation;
  // cards render its requirementStatus rather than re-deciding client-side.
  const [tasks, setTasks] = useState<ApprovalTaskRecord[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [reviewRequestId, setReviewRequestId] = useState(REQUESTS[0]?.id ?? "");
  const [creatingTask, setCreatingTask] = useState(false);
  const [votingOn, setVotingOn] = useState<string | null>(null);

  const refreshTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      setTasks(await listApprovalTasks());
    } catch (e: unknown) {
      pushToast("err", e instanceof Error ? e.message : "Couldn't load review tasks");
    } finally {
      setTasksLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    refreshTasks();
  }, [refreshTasks]);

  async function sendForReview() {
    if (!preview?.authority || !reviewRequestId) return;
    setCreatingTask(true);
    try {
      const created = await createApprovalTask({
        authorityId: preview.authority.id,
        requestId: reviewRequestId,
        // Maker-checker frozen at creation: preparers + the requesting persona.
        exclusions: makerCheckerExclusions(persona.id),
      });
      setTasks((list) => [created, ...list]);
      pushToast("ok", `${reviewRequestId} sent to ${preview.authority.name} for review.`);
    } catch (e: unknown) {
      pushToast("err", e instanceof Error ? e.message : "Couldn't create the review task");
    } finally {
      setCreatingTask(false);
    }
  }

  async function vote(task: ApprovalTaskRecord, verdict: "approve" | "decline") {
    setVotingOn(task.id);
    try {
      const updated = await recordApprovalDecision(task.id, {
        approverId: persona.id,
        approverLabel: persona.name,
        verdict,
      });
      setTasks((list) => list.map((t) => (t.id === updated.id ? updated : t)));
      pushToast("ok", verdict === "approve" ? "Approval recorded." : "Declination recorded.");
    } catch (e: unknown) {
      pushToast("err", e instanceof Error ? e.message : "Vote failed");
    } finally {
      setVotingOn(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Approval Authorities"
        icon={<Landmark size={20} strokeWidth={2} style={{ color: "var(--accent)" }} />}
        actions={
          <>
            <span
              className="rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ background: "var(--panel)", border: "1px solid var(--panel-border)", color: "var(--fg-muted)" }}
            >
              {authorities.length} levels · {autoCount} auto-approve
            </span>
            {canEdit ? (
              <button
                type="button"
                onClick={openCreate}
                className="ring-accent rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110"
                style={{ background: "var(--accent)" }}
              >
                + Create Level
              </button>
            ) : (
              <span
                className="rounded-full px-3 py-1.5 text-xs font-medium"
                style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }}
                title={`${persona.name} (${persona.roleLabel}) can view settings but not change them.`}
              >
                Settings read-only
              </span>
            )}
          </>
        }
      />

      {/* Decision preview — what does the matrix decide for a given request? */}
      {authorities.length > 0 && (
        <div className="glass mb-5 rounded-2xl p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--fg-subtle)" }}>
            Decision preview
          </h3>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>Amount</span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--fg-subtle)" }}>$</span>
                <input
                  value={previewAmount}
                  onChange={(e) => setPreviewAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  className="ring-accent w-36 rounded-lg py-2 pl-7 pr-3 text-sm"
                  style={inputStyle}
                />
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>Risk Grade</span>
              <select
                value={previewGrade}
                onChange={(e) => setPreviewGrade(e.target.value)}
                className="ring-accent rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              >
                {RISK_GRADES.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>Product</span>
              <select
                value={previewProduct}
                onChange={(e) => setPreviewProduct(e.target.value)}
                className="ring-accent rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              >
                {PRODUCTS.filter((p) => p !== "All").map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            {preview && (
              <span
                className="rounded-full px-3 py-1.5 text-xs font-semibold"
                style={
                  preview.lane === "auto-approve"
                    ? { background: "var(--tok-if-bg)", color: "var(--tok-if-fg)" }
                    : preview.lane === "manual"
                    ? { background: "var(--tok-when-bg)", color: "var(--tok-when-fg)" }
                    : preview.lane === "escalate"
                    ? { background: "var(--warn-bg)", color: "var(--warn-fg)" }
                    : { background: "var(--danger-bg)", color: "var(--danger-fg)" }
                }
              >
                {preview.lane === "auto-approve"
                  ? "Auto-approve"
                  : preview.lane === "manual"
                  ? `Manual — ${preview.authority?.name}`
                  : preview.lane === "escalate"
                  ? `Escalates — ${preview.authority?.name}`
                  : "Not covered"}
              </span>
            )}
          </div>
          {preview && (
            <p className="mt-3 text-sm" style={{ color: "var(--fg-muted)" }}>{preview.reason}</p>
          )}
          {preview?.authority && !preview.authority.autoApprove && preview.requirement && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--panel-border)" }}>
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>
                Send for review
              </span>
              <select
                value={reviewRequestId}
                onChange={(e) => setReviewRequestId(e.target.value)}
                className="ring-accent rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
                aria-label="Request to review"
              >
                {REQUESTS.map((r) => (
                  <option key={r.id} value={r.id}>{r.id} — {r.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={sendForReview}
                disabled={creatingTask}
                className="ring-accent rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
                style={{ background: "var(--accent)" }}
              >
                {creatingTask ? "Creating…" : `Create review task → ${preview.authority.name}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Decisions cards — open review tasks with interactive voting */}
      <div className="glass mb-5 rounded-2xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--fg-subtle)" }}>
            Review tasks
          </h3>
          <span className="text-xs" style={{ color: "var(--fg-subtle)" }}>
            {tasks.filter((t) => t.status === "open").length} open · {tasks.length} total
          </span>
        </div>
        {tasksLoading ? (
          <div className="px-4 py-6 text-center text-sm" style={{ color: "var(--fg-subtle)" }}>Loading…</div>
        ) : tasks.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm" style={{ borderColor: "var(--panel-border)", color: "var(--fg-subtle)" }}>
            No review tasks yet — use the decision preview above to send a request for review.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                personaId={persona.id}
                personaName={persona.name}
                voting={votingOn === task.id}
                onVote={(verdict) => vote(task, verdict)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="glass overflow-hidden rounded-2xl">
        {loading ? (
          <div className="px-4 py-10 text-center text-sm" style={{ color: "var(--fg-subtle)" }}>
            Loading…
          </div>
        ) : authorities.length === 0 ? (
          <div className="m-4 rounded-xl border border-dashed px-4 py-10 text-center" style={{ borderColor: "var(--panel-border)" }}>
            <p className="text-sm font-medium" style={{ color: "var(--fg)" }}>No authority levels yet</p>
            {canEdit && (
              <button
                type="button"
                onClick={openCreate}
                className="ring-accent mt-3 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110"
                style={{ background: "var(--accent)" }}
              >
                + Create Level
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>
                  <th className="px-4 py-3">Level</th>
                  <th className="px-4 py-3">Limit</th>
                  <th className="px-4 py-3">Min Grade</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Lane</th>
                  <th className="px-4 py-3">Members</th>
                  <th className="px-4 py-3">Escalates To</th>
                </tr>
              </thead>
              <tbody>
                {authorities.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => openEdit(a)}
                    className="cursor-pointer border-t transition-colors hover:bg-[var(--accent-soft)]"
                    style={{ borderColor: "var(--panel-border)" }}
                  >
                    <td className="px-4 py-3 font-semibold" style={{ color: "var(--fg)" }}>{a.name}</td>
                    <td className="px-4 py-3" style={{ color: "var(--fg)" }}>{formatCurrency(Number(a.limit))}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "var(--tok-when-bg)", color: "var(--tok-when-fg)" }}>
                        {a.riskGrade}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--fg-muted)" }}>{a.product}</td>
                    <td className="px-4 py-3">
                      {a.autoApprove ? (
                        <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "var(--tok-if-bg)", color: "var(--tok-if-fg)" }}>
                          Auto
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--fg-subtle)" }}>Manual</span>
                      )}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--fg-muted)" }}>
                      {a.requirement
                        ? describeRequirement(normalizeRequirement(a.requirement))
                        : a.userIds.length === 0
                        ? "—"
                        : a.userIds.length <= 2
                        ? a.userIds.join(", ")
                        : `${a.userIds.slice(0, 2).join(", ")} +${a.userIds.length - 2}`}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--fg-muted)" }}>
                      {a.escalation?.name ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit / create drawer */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-50"
            style={{ background: "rgba(2, 6, 23, 0.4)" }}
            onClick={closeDrawer}
            aria-hidden
          />
          <div
            className="animate-slidein fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col overflow-y-auto border-l p-6"
            style={{ background: "var(--panel-solid)", borderColor: "var(--panel-border)" }}
            role="dialog"
            aria-label={!canEdit ? "View authority level" : editing ? "Edit authority level" : "Create authority level"}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: "var(--fg)" }}>
                {!canEdit ? "Level (read-only)" : editing ? "Edit Level" : "Create Level"}
              </h2>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close"
                className="ring-accent flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--accent-soft)]"
                style={{ color: "var(--fg-subtle)" }}
              >
                <X size={17} strokeWidth={2} />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <Field label="Name">
                <input
                  value={form.name}
                  disabled={!canEdit}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Senior Underwriter"
                  className="ring-accent w-full rounded-lg px-3 py-2 text-sm disabled:opacity-60"
                  style={inputStyle}
                />
              </Field>

              <Field label="Monetary Limit">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--fg-subtle)" }}>$</span>
                  <input
                    value={form.limit}
                    disabled={!canEdit}
                    onChange={(e) => setForm((f) => ({ ...f, limit: e.target.value.replace(/[^\d.]/g, "") }))}
                    inputMode="decimal"
                    placeholder="250000"
                    className="ring-accent w-full rounded-lg py-2 pl-7 pr-3 text-sm disabled:opacity-60"
                    style={inputStyle}
                  />
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Min Risk Grade">
                  <select
                    value={form.riskGrade}
                    disabled={!canEdit}
                    onChange={(e) => setForm((f) => ({ ...f, riskGrade: e.target.value }))}
                    className="ring-accent w-full rounded-lg px-3 py-2 text-sm disabled:opacity-60"
                    style={inputStyle}
                  >
                    {RISK_GRADES.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Product">
                  <select
                    value={form.product}
                    disabled={!canEdit}
                    onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))}
                    className="ring-accent w-full rounded-lg px-3 py-2 text-sm disabled:opacity-60"
                    style={inputStyle}
                  >
                    {PRODUCTS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="flex items-center justify-between rounded-xl border px-3 py-2.5" style={{ borderColor: "var(--panel-border)" }}>
                <span className="text-sm font-medium" style={{ color: "var(--fg)" }}>Auto-approval lane</span>
                <Toggle
                  size="sm"
                  checked={form.autoApprove}
                  disabled={!canEdit}
                  onChange={(v) => setForm((f) => ({ ...f, autoApprove: v }))}
                  label="Auto-approval lane"
                />
              </div>

              <Field label="Escalation Level">
                <select
                  value={form.escalationId}
                  disabled={!canEdit}
                  onChange={(e) => setForm((f) => ({ ...f, escalationId: e.target.value }))}
                  className="ring-accent w-full rounded-lg px-3 py-2 text-sm disabled:opacity-60"
                  style={inputStyle}
                >
                  <option value="">None</option>
                  {authorities
                    .filter((a) => a.id !== editing?.id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                </select>
              </Field>

              <Field label="Approval Requirement">
                <RequirementEditor
                  value={form.requirement}
                  onChange={(requirement) => setForm((f) => ({ ...f, requirement }))}
                  disabled={!canEdit}
                />
              </Field>
            </div>

            {canEdit && (
              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="ring-accent flex-1 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
                  style={{ background: "var(--accent)" }}
                >
                  {saving ? "Saving…" : editing ? "Update Level" : "Create Level"}
                </button>
                {editing && (
                  <button
                    type="button"
                    onClick={remove}
                    className="ring-accent rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--danger-bg)]"
                    style={{ borderColor: "var(--panel-border)", color: "var(--danger-fg)" }}
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}

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

/**
 * One review task as a decisions card: topology summary, per-seat vote state,
 * sequence progress, and voting buttons for the impersonated persona when the
 * server says their seat is outstanding. Enforcement is server-side — this
 * card only mirrors `requirementStatus`.
 */
function TaskCard({
  task,
  personaId,
  personaName,
  voting,
  onVote,
}: {
  task: ApprovalTaskRecord;
  personaId: string;
  personaName: string;
  voting: boolean;
  onVote: (verdict: "approve" | "decline") => void;
}) {
  const envelope = task.requirement;
  const requirement = normalizeRequirement(envelope?.requirement);
  const exclusions = envelope?.exclusions ?? [];
  const seats = requirementApprovers(requirement);
  const verdictBySeat = new Map(task.decisions.map((d) => [d.approverId, d.verdict]));
  const outstanding = new Set(task.requirementStatus.outstanding.map((a) => a.id));

  const isOpen = task.status === "open";
  const canVote = isOpen && outstanding.has(personaId);
  const isBarred = exclusions.includes(personaId) && seats.some((s) => s.id === personaId);

  const statusStyle =
    task.status === "approved"
      ? { background: "var(--tok-if-bg)", color: "var(--tok-if-fg)" }
      : task.status === "declined"
      ? { background: "var(--danger-bg)", color: "var(--danger-fg)" }
      : task.status === "expired"
      ? { background: "var(--tok-op-bg)", color: "var(--fg-subtle)" }
      : { background: "var(--tok-when-bg)", color: "var(--tok-when-fg)" };

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--panel-border)", background: "var(--panel-solid)" }}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
            {task.requestId}
            <span className="font-normal" style={{ color: "var(--fg-subtle)" }}> · {task.authority?.name ?? "authority removed"}</span>
          </div>
          <div className="mt-0.5 text-xs" style={{ color: "var(--fg-muted)" }}>
            {describeRequirement(requirement)}
          </div>
        </div>
        <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize" style={statusStyle}>
          {task.status}
        </span>
      </div>

      {requirement.type === "sequence" && isOpen && task.requirementStatus.step !== undefined && (
        <div className="mb-2 text-xs font-medium" style={{ color: "var(--warn-fg)" }}>
          Gated at step {task.requirementStatus.step + 1} of {requirement.steps.length}
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {seats.map((seat) => {
          const verdict = verdictBySeat.get(seat.id);
          const excluded = exclusions.includes(seat.id);
          const waiting = outstanding.has(seat.id);
          return (
            <li key={seat.id || seat.label} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2" style={{ color: excluded ? "var(--fg-subtle)" : "var(--fg)" }}>
                <input
                  type="checkbox"
                  checked={verdict === "approve"}
                  readOnly
                  disabled
                  aria-label={`${seat.label} approval state`}
                  className="h-4 w-4 rounded"
                  style={{ accentColor: "var(--accent)" }}
                />
                {seat.label}
                {excluded && (
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "var(--tok-op-bg)", color: "var(--fg-subtle)" }}>
                    maker-checker
                  </span>
                )}
              </span>
              <span
                className="text-xs font-medium capitalize"
                style={{
                  color:
                    verdict === "approve"
                      ? "var(--tok-if-fg)"
                      : verdict === "decline"
                      ? "var(--danger-fg)"
                      : "var(--fg-subtle)",
                }}
              >
                {excluded ? "barred" : verdict ?? (isOpen && waiting ? "pending" : "—")}
              </span>
            </li>
          );
        })}
      </ul>

      {canVote && (
        <div className="mt-3 flex items-center gap-2 border-t pt-3" style={{ borderColor: "var(--panel-border)" }}>
          <span className="text-xs" style={{ color: "var(--fg-muted)" }}>Vote as {personaName}:</span>
          <button
            type="button"
            disabled={voting}
            onClick={() => onVote("approve")}
            className="ring-accent rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: "var(--tok-if-bg)", color: "var(--tok-if-fg)" }}
          >
            <span className="inline-flex items-center gap-1.5"><Check size={13} strokeWidth={2.5} /> Approve</span>
          </button>
          <button
            type="button"
            disabled={voting}
            onClick={() => onVote("decline")}
            className="ring-accent rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:bg-[var(--danger-bg)] disabled:opacity-50"
            style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}
          >
            <span className="inline-flex items-center gap-1.5"><X size={13} strokeWidth={2.5} /> Decline</span>
          </button>
        </div>
      )}
      {isBarred && isOpen && (
        <p className="mt-3 border-t pt-3 text-xs" style={{ borderColor: "var(--panel-border)", color: "var(--warn-fg)" }}>
          {personaName} prepared this request — maker-checker rules bar them from voting on it.
        </p>
      )}
    </div>
  );
}

/* helpers */
let toastSeq = 0;

const inputStyle: React.CSSProperties = {
  background: "var(--panel-solid)",
  border: "1px solid var(--panel-border)",
  color: "var(--fg)",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}
