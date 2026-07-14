/**
 * Server-only Landjourney platform client (demo bridge).
 *
 * Fetches the workflow building blocks from the live admin API
 * (docs/2026-07-14_workflow-creator-admin-buildout-manual_v2.md §3/§7) so the
 * builder's pickers show real templates/stages/users/retailers. Runs ONLY in
 * route handlers — the bearer token never reaches the client bundle.
 *
 * Known blocker (manual §12 Q2): a bare `Authorization: Bearer` returned 500
 * against the live API — the product's HTTP interceptor adds more (tenant
 * header / decompressed token). LANDJOURNEY_EXTRA_HEADERS lets us plug in the
 * missing headers as JSON once Antigravity reads the interceptor in source,
 * without a code change. Until then every section fails gracefully and the
 * app falls back to the static demo vocabulary.
 *
 * Response shapes are [INFER] — the scan confirmed the endpoints, not their
 * JSON bodies — so parsing is defensive: unrecognized shapes surface as a
 * per-section error instead of crashing the route.
 */

import { LiveField, LiveOption, LiveTemplate, LiveVocabulary, VocabularySource } from "@/lib/liveVocabulary";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function platformConfigured(): boolean {
  return Boolean(
    env("LANDJOURNEY_API_BASE") && env("LANDJOURNEY_API_TOKEN") && env("LANDJOURNEY_ORG_ID")
  );
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${env("LANDJOURNEY_API_TOKEN")}`,
    Accept: "application/json",
  };
  const extra = env("LANDJOURNEY_EXTRA_HEADERS");
  if (extra) {
    try {
      Object.assign(h, JSON.parse(extra));
    } catch {
      // Malformed JSON in the env var — ignore rather than break every call.
    }
  }
  return h;
}

async function getJson(path: string): Promise<unknown> {
  const base = env("LANDJOURNEY_API_BASE")!.replace(/\/+$/, "");
  const res = await fetch(`${base}${path}`, { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ---- Defensive parsing (bodies are [INFER], see module docblock) ---- */

type Row = Record<string, unknown>;

/** Accept a bare array or the common list envelopes. */
function extractArray(raw: unknown): Row[] {
  if (Array.isArray(raw)) return raw as Row[];
  if (raw && typeof raw === "object") {
    const o = raw as Row;
    for (const key of ["content", "data", "items", "results", "records", "rows"]) {
      if (Array.isArray(o[key])) return o[key] as Row[];
    }
    const arrays = Object.values(o).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0] as Row[];
  }
  throw new Error("unrecognized list shape");
}

function nameOf(row: Row): string | null {
  for (const key of ["name", "label", "title", "displayName", "display_name", "fullName", "full_name"]) {
    if (typeof row[key] === "string" && row[key]) return row[key] as string;
  }
  const first = row.firstName ?? row.first_name;
  const last = row.lastName ?? row.last_name;
  const joined = [first, last].filter((x) => typeof x === "string" && x).join(" ");
  if (joined) return joined;
  if (typeof row.email === "string" && row.email) return row.email;
  return null;
}

function idOf(row: Row, fallback: string): string {
  for (const key of ["id", "uuid", "key"]) {
    if (typeof row[key] === "string" && row[key]) return row[key] as string;
  }
  return fallback;
}

function toOptions(rows: Row[]): LiveOption[] {
  return rows.flatMap((row) => {
    const label = nameOf(row);
    return label ? [{ id: idOf(row, label), label }] : [];
  });
}

function toTemplates(rows: Row[]): LiveTemplate[] {
  return rows.flatMap((row) => {
    const name = nameOf(row);
    if (!name) return [];
    const rawStages = Array.isArray(row.stages) ? (row.stages as Row[]) : [];
    const requestType = ["requestType", "request_type", "type"]
      .map((k) => row[k])
      .find((v): v is string => typeof v === "string" && v.length > 0);
    return [{ id: idOf(row, name), name, requestType, stages: toOptions(rawStages) }];
  });
}

/**
 * Resolve the session's real org id from GET /iam/users/me (alignment doc §4c).
 * Falls back to LANDJOURNEY_ORG_ID when the identity call can't run. Response
 * shape is [INFER] — probe the plausible org-id locations defensively.
 */
export async function fetchSessionOrgId(): Promise<string | null> {
  const envOrg = env("LANDJOURNEY_ORG_ID") ?? null;
  if (!platformConfigured()) return envOrg;
  try {
    const me = (await getJson(`/iam/users/me`)) as Row;
    for (const key of ["orgId", "organizationId", "organization_id", "org_id"]) {
      if (typeof me[key] === "string" && me[key]) return me[key] as string;
    }
    const org = me.organization as Row | undefined;
    if (org && typeof org.id === "string") return org.id;
    const orgs = me.organizations as Row[] | undefined;
    if (Array.isArray(orgs) && orgs[0] && typeof orgs[0].id === "string") return orgs[0].id;
    return envOrg;
  } catch {
    return envOrg;
  }
}

/**
 * Flatten a dynamic-form definition (array of sections, each with fields[])
 * into LiveField rows. Shape verified in build manual §6a:
 * `{column, fieldType, id, label, name, parameters, required}` per field.
 */
function toLiveFields(raw: unknown, formTemplateId: string, formName: string): LiveField[] {
  // The definition may arrive as the bare sections array (manual §6a) or nested
  // on a form object — probe the plausible homes before the generic envelopes.
  let sections: Row[] = [];
  if (Array.isArray(raw)) {
    sections = raw as Row[];
  } else if (raw && typeof raw === "object") {
    const o = raw as Row;
    for (const key of ["sections", "definition", "formDefinition", "form_definition", "template"]) {
      if (Array.isArray(o[key])) {
        sections = o[key] as Row[];
        break;
      }
    }
    if (!sections.length) {
      try {
        sections = extractArray(raw);
      } catch {
        sections = [];
      }
    }
  }
  // If the probed array is already a flat field list (no sections wrapper), wrap it.
  if (sections.some((s) => typeof s.fieldType === "string")) {
    sections = [{ fields: sections } as Row];
  }
  return sections.flatMap((section) => {
    const fields = Array.isArray(section.fields) ? (section.fields as Row[]) : [];
    return fields.flatMap((f) => {
      const fieldId = typeof f.id === "string" ? f.id : null;
      const fieldType = typeof f.fieldType === "string" ? f.fieldType : null;
      if (!fieldId || !fieldType) return [];
      return [
        {
          formTemplateId,
          formName,
          fieldId,
          name: typeof f.name === "string" ? f.name : fieldId,
          label: typeof f.label === "string" && f.label ? f.label : (f.name as string) ?? fieldId,
          fieldType,
          required: Boolean(f.required),
        },
      ];
    });
  });
}

/** Bound the per-form fan-out so a large tenant can't stampede the API. */
const MAX_FORM_FETCHES = 12;

/* ---- Aggregate fetch across the §7 input surfaces ---- */

export async function fetchLiveVocabulary(): Promise<VocabularySource> {
  const org = env("LANDJOURNEY_ORG_ID")!;
  // Paths + paging conventions exactly as observed live (manual §3 — note the
  // per-service paging inconsistency is real, do not "normalize" these).
  const sections = [
    {
      key: "users",
      path: `/iam/organizations/${org}/users?page=0&groups=EMPLOYEES&include_disabled=false&page_size=100`,
    },
    { key: "retailers", path: `/iam/organizations/${org}/retailers?page=1&pageSize=1000` },
    { key: "templates", path: `/workflows/templates` },
    { key: "forms", path: `/documents/templates/forms` },
  ] as const;

  const settled = await Promise.allSettled(sections.map((s) => getJson(s.path)));

  const errors: string[] = [];
  const rows: Record<string, Row[]> = { users: [], retailers: [], templates: [], forms: [] };
  settled.forEach((result, i) => {
    const key = sections[i].key;
    if (result.status === "rejected") {
      errors.push(`${key}: ${result.reason instanceof Error ? result.reason.message : "failed"}`);
      return;
    }
    try {
      rows[key] = extractArray(result.value);
    } catch (e) {
      errors.push(`${key}: ${e instanceof Error ? e.message : "parse failed"}`);
    }
  });

  const forms = toOptions(rows.forms);

  // Second resolution step (alignment doc §4b): fetch each form's definition
  // and flatten its sections[].fields[] into the ID-bound field registry.
  const fields: LiveField[] = [];
  const formsToFetch = forms.slice(0, MAX_FORM_FETCHES);
  if (forms.length > formsToFetch.length) {
    errors.push(`fields: only first ${MAX_FORM_FETCHES} of ${forms.length} forms fetched`);
  }
  const formBodies = await Promise.allSettled(
    formsToFetch.map((f) => getJson(`/documents/templates/forms/${encodeURIComponent(f.id)}`))
  );
  formBodies.forEach((result, i) => {
    const form = formsToFetch[i];
    if (result.status === "rejected") {
      errors.push(
        `fields(${form.label}): ${result.reason instanceof Error ? result.reason.message : "failed"}`
      );
      return;
    }
    fields.push(...toLiveFields(result.value, form.id, form.label));
  });

  const vocab: LiveVocabulary = {
    source: "live",
    fetchedAt: new Date().toISOString(),
    users: toOptions(rows.users),
    retailers: toOptions(rows.retailers),
    templates: toTemplates(rows.templates),
    forms,
    fields,
    errors,
  };

  // Nothing usable came back → report static so the UI doesn't claim liveness.
  const empty =
    !vocab.users.length && !vocab.retailers.length && !vocab.templates.length && !vocab.forms.length;
  if (empty) {
    return { source: "static", reason: errors.join("; ") || "platform returned no data" };
  }
  return vocab;
}
