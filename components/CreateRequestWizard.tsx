"use client";

import { useState } from "react";
import { RETAILERS, PROGRAMS } from "@/lib/platformData";
import { ASSIGNEES } from "@/lib/vocabulary";

const STEPS = ["Customer", "Template", "Coverage", "Team", "Review"] as const;
const TEMPLATES = ["Loan Application", "Origination", "Covenant", "Blank Request"];

interface Draft {
  customer: string;
  customerType: "Business" | "Individual";
  template: string;
  retailer: string;
  program: string;
  amount: string;
  team: string;
}

const EMPTY: Draft = {
  customer: "",
  customerType: "Business",
  template: "Loan Application",
  retailer: RETAILERS[0],
  program: PROGRAMS[0],
  amount: "",
  team: ASSIGNEES[0],
};

/** Guided 5-step Create New request wizard (demo — does not persist). */
export default function CreateRequestWizard({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  onComplete: (summary: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  if (!open) return null;

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const canNext =
    (step === 0 && draft.customer.trim().length > 1) ||
    (step === 1 && !!draft.template) ||
    (step === 2 && Number(draft.amount) > 0) ||
    step === 3 ||
    step === 4;

  function finish() {
    onComplete(`Draft request created for ${draft.customer} (${draft.template}).`);
    setStep(0);
    setDraft(EMPTY);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[8vh]" onMouseDown={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.45)" }} />
      <div
        className="glass animate-popin relative flex max-h-[80vh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header + stepper */}
        <div className="px-5 pt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold" style={{ color: "var(--fg)" }}>Create New request</h3>
            <button type="button" onClick={onClose} aria-label="Close" className="ring-accent rounded-lg px-2 py-1 text-lg" style={{ color: "var(--fg-subtle)" }}>×</button>
          </div>
          <div className="mt-4 flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <div key={s} className="flex flex-1 items-center gap-1.5">
                <div
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                  style={{
                    background: i <= step ? "var(--accent)" : "var(--tok-op-bg)",
                    color: i <= step ? "#fff" : "var(--fg-subtle)",
                  }}
                >
                  {i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div className="h-0.5 flex-1 rounded" style={{ background: i < step ? "var(--accent)" : "var(--tok-op-bg)" }} />
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </div>
        </div>

        {/* Body */}
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-5">
          {step === 0 && (
            <div className="flex flex-col gap-3">
              <Label text="Customer name">
                <input value={draft.customer} onChange={(e) => set({ customer: e.target.value })} placeholder="e.g. Prairie Gold Farms LLC" className="wiz-input" style={inputStyle} />
              </Label>
              <Label text="Customer type">
                <div className="flex gap-2">
                  {(["Business", "Individual"] as const).map((t) => (
                    <Choice key={t} on={draft.customerType === t} onClick={() => set({ customerType: t })}>{t}</Choice>
                  ))}
                </div>
              </Label>
            </div>
          )}

          {step === 1 && (
            <Label text="Template">
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map((t) => (
                  <Choice key={t} on={draft.template === t} onClick={() => set({ template: t })}>{t}</Choice>
                ))}
              </div>
            </Label>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <Label text="Retailer">
                <select value={draft.retailer} onChange={(e) => set({ retailer: e.target.value })} style={inputStyle}>
                  {RETAILERS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </Label>
              <Label text="Program">
                <select value={draft.program} onChange={(e) => set({ program: e.target.value })} style={inputStyle}>
                  {PROGRAMS.map((p) => <option key={p}>{p}</option>)}
                </select>
              </Label>
              <Label text="Loan amount">
                <input value={draft.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" placeholder="e.g. 250000" style={inputStyle} />
              </Label>
            </div>
          )}

          {step === 3 && (
            <Label text="Team member / owner">
              <div className="grid grid-cols-2 gap-2">
                {ASSIGNEES.map((a) => (
                  <Choice key={a} on={draft.team === a} onClick={() => set({ team: a })}>{a}</Choice>
                ))}
              </div>
            </Label>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-2 rounded-xl p-4" style={{ background: "var(--panel-solid)", border: "1px solid var(--panel-border)" }}>
              <Row k="Customer" v={`${draft.customer || "—"} (${draft.customerType})`} />
              <Row k="Template" v={draft.template} />
              <Row k="Retailer & Program" v={`${draft.retailer} · ${draft.program}`} />
              <Row k="Amount" v={draft.amount ? "$" + Number(draft.amount).toLocaleString("en-US") : "—"} />
              <Row k="Owner" v={draft.team} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderTop: "1px solid var(--panel-border)" }}>
          <button
            type="button"
            onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
            className="ring-accent rounded-xl px-4 py-2 text-sm font-medium"
            style={{ color: "var(--fg-muted)" }}
          >
            {step === 0 ? "Cancel" : "← Back"}
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setStep(step + 1)}
              className="ring-accent rounded-xl px-5 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              Continue →
            </button>
          ) : (
            <button
              type="button"
              onClick={finish}
              className="ring-accent rounded-xl px-5 py-2 text-sm font-semibold text-white transition-all hover:brightness-110"
              style={{ background: "var(--accent)" }}
            >
              Create request
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  padding: "8px 10px",
  fontSize: 14,
  background: "var(--panel-solid)",
  border: "1px solid var(--panel-border)",
  color: "var(--fg)",
};

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>{text}</span>
      {children}
    </label>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ring-accent rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all"
      style={{
        background: on ? "var(--accent-soft)" : "var(--panel-solid)",
        border: `1px solid ${on ? "var(--ring)" : "var(--panel-border)"}`,
        color: on ? "var(--accent)" : "var(--fg)",
      }}
    >
      {children}
    </button>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: "var(--fg-subtle)" }}>{k}</span>
      <span className="font-medium" style={{ color: "var(--fg)" }}>{v}</span>
    </div>
  );
}
