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

import { ACTIONS, ASSIGNEES, FIELDS, FieldKind } from "@/lib/vocabulary";
import { REQUESTS } from "@/lib/platformData";

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

/**
 * A real per-template dynamic-form field (build manual §6a) — the ID-bound
 * operand behind Application-Data conditions (alignment doc §4b).
 */
export interface LiveField {
  formTemplateId: string;
  formName: string;
  fieldId: string;
  /** Stable machine key, e.g. "newField3". */
  name: string;
  label: string;
  /** Raw platform fieldType: INPUT | NUMBER | MONEY | SELECT | LIVESTOCK | … */
  fieldType: string;
  required: boolean;
}

/** Map a platform fieldType onto the builder's operator model. */
export function fieldKindForType(fieldType: string): FieldKind {
  const t = fieldType.toUpperCase();
  if (t === "NUMBER" || t === "MONEY" || t === "COMPUTED") return "numeric";
  if (t === "SELECT" || t === "RADIO" || t === "CHECKBOX" || t === "YES_NO_QUESTIONNAIRE") return "enum";
  return "text";
}

export interface LiveVocabulary {
  source: "live";
  fetchedAt: string;
  users: LiveOption[];
  retailers: LiveOption[];
  customers: LiveOption[];
  templates: LiveTemplate[];
  forms: LiveOption[];
  /** Flattened per-form field registry (bounded fan-out; see lib/platform.ts). */
  fields: LiveField[];
  /** Sections that failed to fetch/parse (partial live data still applies). */
  errors: string[];
}

export type VocabularySource = LiveVocabulary | { source: "static"; reason: string };

export interface CustomVocabularySync {
  fields?: { id: string; name: string; type: string; category: string; description: string }[];
  tags?: string[];
}

/* ---- Overlay: live values merged onto the static token option lists ---- */

/** ID-bearing instance registries for the scoped pickers + reference audit
 *  (Phase 2). Empty in static mode — Specific sections then fall back to plain
 *  label options that emit legacy strings (no fabricated ids, ever). */
export interface ScopedInstances {
  templates: LiveOption[];
  retailers: LiveOption[];
  customers: LiveOption[];
  users: LiveOption[];
  /** id = `${templateId}:${stageId}`, label = `Template › Stage` (kills C7). */
  stages: LiveOption[];
  /** Approval authorities, injected client-side from listAuthorities(). */
  authorities: LiveOption[];
}

export function emptyInstances(): ScopedInstances {
  return { templates: [], retailers: [], customers: [], users: [], stages: [], authorities: [] };
}

export interface VocabOverlay {
  /** field key → option values for the condition-value picker */
  fieldOptions: Record<string, string[]>;
  /** action key → option values for the action-param picker */
  actionParamOptions: Record<string, string[]>;
  /** Real per-template form fields, offered as ID-bound condition operands. */
  liveFields: LiveField[];
  /** Live instance registries for scoped (category/instance) pickers. */
  instances: ScopedInstances;
}

export function readCustomVocabularySync(): CustomVocabularySync {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem("wf-custom-vocab");
    return raw ? (JSON.parse(raw) as CustomVocabularySync) : {};
  } catch {
    return {};
  }
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
  // Read synced custom vocab from localStorage (safe client hook).
  const customVocab = readCustomVocabularySync();

  // If there's no live source, build a partial overlay just for the custom vocabulary.
  const activeVocab = v && v.source === "live" ? v : {
    source: "static" as const,
    reason: "fallback",
    users: [],
    retailers: [],
    customers: [],
    templates: [],
    forms: [],
    fields: [],
    errors: [],
  };

  const users = activeVocab.users.map((u) => u.label);
  const retailers = activeVocab.retailers.map((r) => r.label);
  const customers = activeVocab.customers.map((c) => c.label);
  const stages = merge(
    dedupe(activeVocab.templates.flatMap((t) => t.stages.map((s) => s.label))),
    FIELDS.stage.options
  );
  const reqTypes = merge(
    dedupe(activeVocab.templates.map((t) => t.requestType ?? "").filter(Boolean)),
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
  if (customers.length) fieldOptions.customer_name = customers;
  if (activeVocab.templates.length) {
    fieldOptions.stage = stages;
    fieldOptions.reqtype = reqTypes;
    fieldOptions.template = activeVocab.templates.map((t) => t.name);
    actionParamOptions.change_stage = merge(
      stages,
      ACTIONS.find((a) => a.key === "change_stage")?.paramOptions
    );
  }

  // Merge Custom Synced Tags
  if (customVocab.tags && customVocab.tags.length) {
    fieldOptions.tags = merge(customVocab.tags, FIELDS.tags.options);
    actionParamOptions.add_tag = merge(customVocab.tags, ACTIONS.find((a) => a.key === "add_tag")?.paramOptions);
    actionParamOptions.remove_tag = merge(customVocab.tags, ACTIONS.find((a) => a.key === "remove_tag")?.paramOptions);
  }

  // Phase 2: ID-bearing registries for scoped pickers. Stage instances are
  // template-qualified so two same-named stages stay distinct (C7).
  const instances: ScopedInstances = {
    templates: activeVocab.templates.map((t) => ({ id: t.id, label: t.name })),
    retailers: activeVocab.retailers,
    customers: activeVocab.customers.length ? activeVocab.customers : dedupeRequestsCustomers(),
    users: activeVocab.users,
    stages: activeVocab.templates.flatMap((t) =>
      t.stages.map((s) => ({ id: `${t.id}:${s.id}`, label: `${t.name} › ${s.label}` }))
    ),
    authorities: [], // injected client-side (listAuthorities) — see WorkflowCreator
  };

  // Merge Custom Synced Fields (e.g. Crop Details, Yes/No Questionnaire)
  const baseFields = activeVocab.fields ?? [];
  const customFields: LiveField[] = (customVocab.fields ?? []).map((f) => ({
    formTemplateId: "custom-vocab-sync",
    formName: f.category,
    fieldId: f.id,
    name: f.id,
    label: f.name,
    // Sync spec: object → text (INPUT), array → enum (SELECT). "ARRAY" alone
    // falls through fieldKindForType() to "text", so map it to an enum type.
    fieldType:
      f.type.toUpperCase() === "OBJECT"
        ? "INPUT"
        : f.type.toUpperCase() === "ARRAY"
          ? "SELECT"
          : f.type.toUpperCase(),
    required: false,
  }));

  return { fieldOptions, actionParamOptions, liveFields: [...baseFields, ...customFields], instances };
}

function dedupeRequestsCustomers(): LiveOption[] {
  const seen = new Set<string>();
  const out: LiveOption[] = [];
  for (const request of REQUESTS) {
    const label = request.mainBorrower.trim();
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `seed:${request.id}`, label });
  }
  return out;
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
    `${v.fields?.length ?? 0} form fields`,
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
