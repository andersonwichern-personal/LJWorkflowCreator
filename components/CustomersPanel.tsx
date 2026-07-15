"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  mergeCustomersApi,
  listCustomers,
  type CustomerExposureSummary,
  type CustomerRecord,
} from "@/lib/api";
import { useViewpoint } from "@/lib/viewpoint";
import PageHeader from "@/components/ui/PageHeader";
import { ExternalLink } from "lucide-react";

type Toast = { id: number; kind: "ok" | "err"; text: string };

export default function CustomersPanel() {
  const { canEdit, persona } = useViewpoint();
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [summaries, setSummaries] = useState<CustomerExposureSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pushToast = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listCustomers();
      setCustomers(data.customers);
      setSummaries(data.summaries);
    } catch (e: unknown) {
      pushToast("err", e instanceof Error ? e.message : "Couldn't load customers");
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const summaryByCustomerId = useMemo(
    () => new Map(summaries.map((s) => [s.customerId, s])),
    [summaries]
  );

  async function merge(customer: CustomerRecord) {
    if (!canEdit) return;
    const duplicateId = prompt(`Duplicate customer id to merge into ${customer.name}:`);
    if (!duplicateId) return;
    const duplicate = byId.get(duplicateId);
    if (!duplicate) {
      pushToast("err", "That customer id is not in the current list.");
      return;
    }
    const reason = prompt("Reason for merge:") || "manual merge";
    setBusyId(customer.id);
    try {
      const result = await mergeCustomersApi({
        survivorId: customer.id,
        duplicateId,
        reason,
        actorId: persona.id,
        expectedVersion: duplicate.version,
      });
      pushToast("ok", result.noOp ? "Merge already applied." : "Merge complete.");
      await refresh();
    } catch (e: unknown) {
      pushToast("err", e instanceof Error ? e.message : "Merge failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Customers" subtitle="Entity integrity and merge-safe records" />
      <div className="glass rounded-2xl p-4">
        {loading ? (
          <div className="py-8 text-sm" style={{ color: "var(--fg-subtle)" }}>
            Loading customers…
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {customers.map((c) => {
              return (
                <div key={c.id} className="rounded-xl border p-3" style={{ borderColor: "var(--panel-border)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
                        {c.name}
                      </div>
                      <div className="mt-0.5 text-xs" style={{ color: "var(--fg-subtle)" }}>
                        {c.type} · {c.id}
                      </div>
                    </div>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                      style={
                        c.status === "active"
                          ? { background: "var(--tok-if-bg)", color: "var(--tok-if-fg)" }
                          : c.status === "merged"
                          ? { background: "var(--warn-bg)", color: "var(--warn-fg)" }
                          : { background: "var(--danger-bg)", color: "var(--danger-fg)" }
                      }
                    >
                      {c.status}
                    </span>
                  </div>

                  {c.mergedIntoId && (
                    <div className="mt-2 text-xs" style={{ color: "var(--fg-subtle)" }}>
                      Merged into {byId.get(c.mergedIntoId)?.name ?? c.mergedIntoId}
                    </div>
                  )}

                  <div className="mt-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--fg-subtle)" }}>
                      Related entities
                    </div>
                    {(() => {
                      const summary = summaryByCustomerId.get(c.id);
                      if (!summary) {
                        return (
                          <div className="mt-1 text-xs" style={{ color: "var(--fg-subtle)" }}>
                            No graph summary available yet.
                          </div>
                        );
                      }
                      return (
                        <div className="mt-1 space-y-1 text-xs" style={{ color: "var(--fg-subtle)" }}>
                          <div>
                            {summary.connectedPartyCount} connected party{summary.connectedPartyCount === 1 ? "" : "ies"}
                          </div>
                          <div>{summary.relationshipCount} relationship edge{summary.relationshipCount === 1 ? "" : "s"}</div>
                          <div>
                            {summary.brokenReferenceCount > 0
                              ? `${summary.brokenReferenceCount} broken reference${summary.brokenReferenceCount === 1 ? "" : "s"}`
                              : "No broken references"}
                          </div>
                          {summary.canonicalCustomerId && summary.canonicalCustomerId !== c.id && (
                            <div>
                              Canonical id: {summary.canonicalCustomerId}
                            </div>
                          )}
                          {summary.connectedCustomers.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {summary.connectedCustomers.slice(0, 4).map((party) => (
                                <span
                                  key={party.id}
                                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                                  style={{
                                    background:
                                      party.status === "active"
                                        ? "var(--tok-if-bg)"
                                        : party.status === "merged"
                                        ? "var(--warn-bg)"
                                        : "var(--danger-bg)",
                                    color:
                                      party.status === "active"
                                        ? "var(--tok-if-fg)"
                                        : party.status === "merged"
                                        ? "var(--warn-fg)"
                                        : "var(--danger-fg)",
                                  }}
                                  title={`${party.name} · ${party.id}`}
                                >
                                  {party.name}
                                </span>
                              ))}
                              {summary.connectedCustomers.length > 4 && (
                                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                                  +{summary.connectedCustomers.length - 4} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold uppercase" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                      <ExternalLink size={11} strokeWidth={2} />
                      Graph ready
                    </div>
                  </div>

                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => merge(c)}
                      disabled={busyId === c.id}
                      className="ring-accent mt-3 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all hover:brightness-110 disabled:opacity-60"
                      style={{ background: "var(--accent)" }}
                    >
                      {busyId === c.id ? "Merging…" : "Merge duplicate…"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border px-3 py-2 text-sm shadow-lg"
              style={{
                borderColor: t.kind === "ok" ? "var(--tok-if-br)" : "var(--danger-br)",
                background: t.kind === "ok" ? "var(--tok-if-bg)" : "var(--danger-bg)",
                color: t.kind === "ok" ? "var(--tok-if-fg)" : "var(--danger-fg)",
              }}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
