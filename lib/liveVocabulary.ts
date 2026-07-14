/**
 * Demo-bridge live vocabulary (client-safe module).
 *
 * Implements Option B of the admin build-out manual
 * (docs/2026-07-14_workflow-creator-admin-buildout-manual_v2.md §11): the
 * prototype keeps its UX and frozen v2 rule schema, but its pickers sync with
 * the *real* platform building blocks (users, retailers, request-template
 * stages) fetched through /api/platform/vocabulary. When the platform isn't
 * configured or reachable, everything falls back to the static demo
 * vocabulary in lib/vocabulary.ts — the UI shows which source is active.
 *
 * Guardrails (manual §13): live data only ever *adds option values* to
 * existing verified tokens. It never introduces new events (System Events is
 * client-mocked in test) and never builds a role/authority ladder.
 */

import { ACTIONS, ASSIGNEES, FIELDS } from "@/lib/vocabulary";

/* ---- Shapes shared with the server proxy (lib/platform.ts) ---- */

export interface LiveOption {
  id: string;
  label: string;
}

export interface LiveTemplate {
  id: string;
  name: string;
  requestType?: string;
  stages: LiveOption[];
}

export interface LiveVocabulary {
  source: "live";
  fetchedAt: string;
  users: LiveOption[];
  retailers: LiveOption[];
  templates: LiveTemplate[];
  forms: LiveOption[];
  /** Sections that failed to fetch/parse (partial live data still applies). */
  errors: string[];
}

export type VocabularySource = LiveVocabulary | { source: "static"; reason: string };

/* ---- Overlay: live values merged onto the static token option lists ---- */

export interface VocabOverlay {
  /** field key → option values for the condition-value picker */
  fieldOptions: Record<string, string[]>;
  /** action key → option values for the action-param picker */
  actionParamOptions: Record<string, string[]>;
}

/** Live values first, then static entries not already present (case-insensitive). */
function merge(live: string[], base: string[] = []): string[] {
  const seen = new Set(live.map((v) => v.toLowerCase()));
  return [...live, ...base.filter((b) => !seen.has(b.toLowerCase()))];
}

/**
 * Map live platform data onto the pickers. Static demo values are kept (after
 * the live ones) so the representative-data simulation still matches.
 */
export function buildOverlay(v: VocabularySource | null): VocabOverlay | null {
  if (!v || v.source !== "live") return null;

  const users = v.users.map((u) => u.label);
  const retailers = v.retailers.map((r) => r.label);
  const stages = merge(
    dedupe(v.templates.flatMap((t) => t.stages.map((s) => s.label))),
    FIELDS.stage.options
  );
  const reqTypes = merge(
    dedupe(v.templates.map((t) => t.requestType ?? "").filter(Boolean)),
    FIELDS.reqtype.options
  );

  const fieldOptions: Record<string, string[]> = {};
  const actionParamOptions: Record<string, string[]> = {};

  if (users.length) {
    fieldOptions.team_member = merge(users, ASSIGNEES);
    actionParamOptions.assign_user = merge(users, ASSIGNEES);
    actionParamOptions.notify = merge(users, ASSIGNEES);
  }
  if (retailers.length) fieldOptions.retailer = retailers;
  if (v.templates.length) {
    fieldOptions.stage = stages;
    fieldOptions.reqtype = reqTypes;
    fieldOptions.template = v.templates.map((t) => t.name);
    actionParamOptions.change_stage = merge(
      stages,
      ACTIONS.find((a) => a.key === "change_stage")?.paramOptions
    );
  }

  return { fieldOptions, actionParamOptions };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((val) => {
    const k = val.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** One-line summary for the source chip's tooltip. */
export function describeSource(v: VocabularySource | null): string {
  if (!v) return "Checking platform connection…";
  if (v.source === "static") return `Static demo vocabulary — ${v.reason}`;
  const parts = [
    `${v.users.length} users`,
    `${v.retailers.length} retailers`,
    `${v.templates.length} templates`,
    `${v.forms.length} forms`,
  ];
  const errs = v.errors.length ? ` · failed: ${v.errors.join("; ")}` : "";
  return `Live platform vocabulary — ${parts.join(", ")}${errs}`;
}

/** Client fetch of the server proxy. Never throws. */
export async function loadLiveVocabulary(): Promise<VocabularySource> {
  try {
    const res = await fetch("/api/platform/vocabulary");
    if (!res.ok) return { source: "static", reason: `proxy HTTP ${res.status}` };
    return (await res.json()) as VocabularySource;
  } catch {
    return { source: "static", reason: "proxy unreachable" };
  }
}
