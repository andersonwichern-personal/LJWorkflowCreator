"use client";

import { ApprovalRequirement, ApproverRef, MAX_SEQUENCE_STEPS } from "@/lib/authorityEngine";
import { ASSIGNEES } from "@sweet/rule-core";
import { approverIdFor } from "@/lib/viewpoint";

/** Quorum topologies a single step can take (sequences nest these). */
type QuorumRequirement =
  | { type: "any_of"; approvers: ApproverRef[] }
  | { type: "n_of"; count: number; approvers: ApproverRef[] }
  | { type: "all_of"; approvers: ApproverRef[] };

const QUORUM_TYPES: { value: QuorumRequirement["type"]; label: string }[] = [
  { value: "any_of", label: "Any one approver" },
  { value: "n_of", label: "Quorum (N of M)" },
  { value: "all_of", label: "All approvers" },
];

const POOL: ApproverRef[] = ASSIGNEES.map((name) => ({ id: approverIdFor(name), label: name }));

function emptyQuorum(): QuorumRequirement {
  return { type: "any_of", approvers: [] };
}

function asQuorum(req: ApprovalRequirement): QuorumRequirement {
  if (req.type === "sequence") {
    const first = req.steps[0];
    return first && first.type !== "sequence" ? (first as QuorumRequirement) : emptyQuorum();
  }
  return req;
}

function withType(q: QuorumRequirement, type: QuorumRequirement["type"]): QuorumRequirement {
  if (type === "n_of") {
    return { type, count: Math.min(2, Math.max(1, q.approvers.length || 1)), approvers: q.approvers };
  }
  return { type, approvers: q.approvers };
}

function toggleApprover(q: QuorumRequirement, ref: ApproverRef): QuorumRequirement {
  const has = q.approvers.some((a) => a.id === ref.id);
  const approvers = has ? q.approvers.filter((a) => a.id !== ref.id) : [...q.approvers, ref];
  if (q.type === "n_of") {
    return { ...q, approvers, count: Math.min(q.count, Math.max(1, approvers.length)) };
  }
  return { ...q, approvers };
}

const inputStyle: React.CSSProperties = {
  background: "var(--panel-solid)",
  border: "1px solid var(--panel-border)",
  color: "var(--fg)",
};

function QuorumEditor({
  value,
  onChange,
  disabled,
}: {
  value: QuorumRequirement;
  onChange: (q: QuorumRequirement) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={value.type}
          disabled={disabled}
          onChange={(e) => onChange(withType(value, e.target.value as QuorumRequirement["type"]))}
          className="ring-accent rounded-lg px-2.5 py-1.5 text-sm disabled:opacity-60"
          style={inputStyle}
          aria-label="Quorum type"
        >
          {QUORUM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        {value.type === "n_of" && (
          <label className="flex items-center gap-1.5 text-sm" style={{ color: "var(--fg-muted)" }}>
            requires
            <input
              type="number"
              min={1}
              max={Math.max(1, value.approvers.length)}
              value={value.count}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...value,
                  count: Math.max(1, Math.min(Number(e.target.value) || 1, Math.max(1, value.approvers.length))),
                })
              }
              className="ring-accent w-16 rounded-lg px-2 py-1.5 text-sm disabled:opacity-60"
              style={inputStyle}
              aria-label="Approvals required"
            />
            of {value.approvers.length}
          </label>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5 rounded-xl border p-3" style={{ borderColor: "var(--panel-border)" }}>
        {POOL.map((ref) => (
          <label
            key={ref.id}
            className={`flex items-center gap-2 text-sm ${disabled ? "" : "cursor-pointer"}`}
            style={{ color: "var(--fg)" }}
          >
            <input
              type="checkbox"
              checked={value.approvers.some((a) => a.id === ref.id)}
              disabled={disabled}
              onChange={() => onChange(toggleApprover(value, ref))}
              className="ring-accent h-4 w-4 rounded"
              style={{ accentColor: "var(--accent)" }}
            />
            {ref.label}
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Phase 3: dynamic ApprovalRequirement configuration — replaces the static
 * assigned-users checklist. Supports single quorums (any/N-of/all) and gated
 * sequences of up to 5 quorum steps.
 */
export default function RequirementEditor({
  value,
  onChange,
  disabled,
}: {
  value: ApprovalRequirement;
  onChange: (req: ApprovalRequirement) => void;
  disabled?: boolean;
}) {
  const isSequence = value.type === "sequence";
  const steps: QuorumRequirement[] =
    value.type === "sequence"
      ? value.steps.map((s) => (s.type === "sequence" ? emptyQuorum() : (s as QuorumRequirement)))
      : [];

  function setStep(i: number, q: QuorumRequirement) {
    const next = steps.slice();
    next[i] = q;
    onChange({ type: "sequence", steps: next });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--fg)" }}>
          <input
            type="checkbox"
            checked={isSequence}
            disabled={disabled}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? { type: "sequence", steps: [asQuorum(value)] }
                  : asQuorum(value)
              )
            }
            className="ring-accent h-4 w-4 rounded"
            style={{ accentColor: "var(--accent)" }}
          />
          Sequential review path
        </label>
        {isSequence && (
          <span className="text-xs" style={{ color: "var(--fg-subtle)" }}>
            {steps.length}/{MAX_SEQUENCE_STEPS} steps
          </span>
        )}
      </div>

      {!isSequence && (
        <QuorumEditor value={asQuorum(value)} onChange={onChange} disabled={disabled} />
      )}

      {isSequence && (
        <div className="flex flex-col gap-3">
          {steps.map((step, i) => (
            <div
              key={i}
              className="rounded-xl border p-3"
              style={{ borderColor: "var(--panel-border)" }}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>
                  Step {i + 1}
                </span>
                {!disabled && steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onChange({ type: "sequence", steps: steps.filter((_, j) => j !== i) })}
                    className="ring-accent rounded-lg px-2 py-0.5 text-xs transition-colors hover:bg-[var(--danger-bg)]"
                    style={{ color: "var(--danger-fg)" }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <QuorumEditor value={step} onChange={(q) => setStep(i, q)} disabled={disabled} />
            </div>
          ))}
          {!disabled && steps.length < MAX_SEQUENCE_STEPS && (
            <button
              type="button"
              onClick={() => onChange({ type: "sequence", steps: [...steps, emptyQuorum()] })}
              className="ring-accent rounded-xl border border-dashed px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--accent-soft)]"
              style={{ borderColor: "var(--panel-border)", color: "var(--fg-muted)" }}
            >
              + Add step
            </button>
          )}
        </div>
      )}
    </div>
  );
}
