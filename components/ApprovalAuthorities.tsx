"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AuthorityRecord,
  AuthorityInput,
  listAuthorities,
  createAuthority,
  updateAuthority,
  deleteAuthority,
} from "@/lib/api";
import { ASSIGNEES } from "@/lib/vocabulary";
import { decideAuthority } from "@/lib/authorityEngine";
import { formatCurrency } from "@/lib/platformData";
import PageHeader from "@/components/ui/PageHeader";
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
  userIds: string[];
}

const EMPTY_FORM: DrawerForm = {
  name: "",
  limit: "",
  riskGrade: "A",
  product: "All",
  autoApprove: false,
  escalationId: "",
  userIds: [],
};

/**
 * Approval Authority matrix (Option C): each level maps Amount + Risk Grade +
 * Product to assigned approvers, with optional auto-approval lanes and an
 * escalation target. Levels feed the Rules Canvas `escalate to authority`
 * action dynamically.
 */
export default function ApprovalAuthorities() {
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
      userIds: Array.isArray(a.userIds) ? a.userIds : [],
    });
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditing(null);
  }

  function toggleUser(name: string) {
    setForm((f) => ({
      ...f,
      userIds: f.userIds.includes(name)
        ? f.userIds.filter((u) => u !== name)
        : [...f.userIds, name],
    }));
  }

  async function save() {
    if (!form.name.trim()) return pushToast("err", "Give the level a name first.");
    const limit = Number(form.limit);
    if (!form.limit.trim() || !Number.isFinite(limit) || limit < 0) {
      return pushToast("err", "Enter a valid monetary limit.");
    }
    const payload: AuthorityInput = {
      name: form.name.trim(),
      limit,
      riskGrade: form.riskGrade,
      product: form.product,
      autoApprove: form.autoApprove,
      escalationId: form.escalationId || null,
      userIds: form.userIds,
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

  return (
    <div>
      <PageHeader
        title="Approval Authorities"
        icon="🏛️"
        actions={
          <>
            <span
              className="rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ background: "var(--panel)", border: "1px solid var(--panel-border)", color: "var(--fg-muted)" }}
            >
              {authorities.length} levels · {autoCount} auto-approve
            </span>
            <button
              type="button"
              onClick={openCreate}
              className="ring-accent rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110"
              style={{ background: "var(--accent)" }}
            >
              + Create Level
            </button>
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
        </div>
      )}

      <div className="glass overflow-hidden rounded-2xl">
        {loading ? (
          <div className="px-4 py-10 text-center text-sm" style={{ color: "var(--fg-subtle)" }}>
            Loading…
          </div>
        ) : authorities.length === 0 ? (
          <div className="m-4 rounded-xl border border-dashed px-4 py-10 text-center" style={{ borderColor: "var(--panel-border)" }}>
            <p className="text-sm font-medium" style={{ color: "var(--fg)" }}>No authority levels yet</p>
            <button
              type="button"
              onClick={openCreate}
              className="ring-accent mt-3 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110"
              style={{ background: "var(--accent)" }}
            >
              + Create Level
            </button>
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
                      {a.userIds.length === 0
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
            aria-label={editing ? "Edit authority level" : "Create authority level"}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: "var(--fg)" }}>
                {editing ? "Edit Level" : "Create Level"}
              </h2>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close"
                className="ring-accent flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-colors hover:bg-[var(--accent-soft)]"
                style={{ color: "var(--fg-subtle)" }}
              >
                ×
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Senior Underwriter"
                  className="ring-accent w-full rounded-lg px-3 py-2 text-sm"
                  style={inputStyle}
                />
              </Field>

              <Field label="Monetary Limit">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--fg-subtle)" }}>$</span>
                  <input
                    value={form.limit}
                    onChange={(e) => setForm((f) => ({ ...f, limit: e.target.value.replace(/[^\d.]/g, "") }))}
                    inputMode="decimal"
                    placeholder="250000"
                    className="ring-accent w-full rounded-lg py-2 pl-7 pr-3 text-sm"
                    style={inputStyle}
                  />
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Min Risk Grade">
                  <select
                    value={form.riskGrade}
                    onChange={(e) => setForm((f) => ({ ...f, riskGrade: e.target.value }))}
                    className="ring-accent w-full rounded-lg px-3 py-2 text-sm"
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
                    onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))}
                    className="ring-accent w-full rounded-lg px-3 py-2 text-sm"
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
                  onChange={(v) => setForm((f) => ({ ...f, autoApprove: v }))}
                  label="Auto-approval lane"
                />
              </div>

              <Field label="Escalation Level">
                <select
                  value={form.escalationId}
                  onChange={(e) => setForm((f) => ({ ...f, escalationId: e.target.value }))}
                  className="ring-accent w-full rounded-lg px-3 py-2 text-sm"
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

              <Field label="Assigned Users">
                <div className="grid grid-cols-2 gap-1.5 rounded-xl border p-3" style={{ borderColor: "var(--panel-border)" }}>
                  {ASSIGNEES.map((name) => (
                    <label key={name} className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--fg)" }}>
                      <input
                        type="checkbox"
                        checked={form.userIds.includes(name)}
                        onChange={() => toggleUser(name)}
                        className="ring-accent h-4 w-4 rounded"
                        style={{ accentColor: "var(--accent)" }}
                      />
                      {name}
                    </label>
                  ))}
                </div>
              </Field>
            </div>

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
