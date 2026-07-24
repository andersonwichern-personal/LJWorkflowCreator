/**
 * GENERATED from packages/workflow-brain/src/context.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/workflow-brain contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
/**
 * context — the replaceable context-window contract of the Workflow Brain.
 *
 * A "context window" here is a versioned, bounded, typed snapshot of the
 * information the Brain is PERMITTED to use for one session or request — not a
 * large string pasted into an LLM prompt. Hosts (standalone demo, Landjourney
 * live platform) implement `WorkflowBrainContextProvider` (see ports.ts) and
 * return these shapes; the Brain never knows which host produced them.
 *
 * Interface freeze authored by honeycomb-lead (2026-07-24). Every teammate
 * codes against these names; changes go through the lead.
 */

import { WorkflowRule } from "../core/vocabulary";

/* -------------------------------------------------------------------------- */
/* Profiles                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Context profiles constrain and prioritize WHAT the snapshot contains. They
 * never grant permissions — capability/authorization stays host-provided and
 * fail-closed (ports.ts `HostCapabilityPort`).
 */
export type ContextProfileId =
  | "standalone-demo"
  | "landjourney-live"
  | "workflow-revision"
  | "template-scoped"
  | "read-only-review";

/* -------------------------------------------------------------------------- */
/* Identity and privacy                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Opaque tenant identity. `tenantKey` is whatever the host uses to partition
 * data (for Landjourney: the UI-configuration dnsPrefix carried as
 * `x-organization`). The Brain treats it as an opaque cache-partition key and
 * never derives anything from its content.
 */
export interface ContextIdentity {
  tenantKey: string;
  /** Opaque org display handle — safe to show in UI, never parsed. */
  organizationLabel?: string;
  /** Host-declared role of the current user (opaque to the Brain). */
  userRole?: string;
  locale?: string;
  timezone?: string;
  featureFlags?: Record<string, boolean>;
}

/** Privacy classification a host stamps on context sections. */
export type PrivacyClass = "public-vocabulary" | "tenant-internal" | "customer-data";

/* -------------------------------------------------------------------------- */
/* Vocabulary entities                                                        */
/* -------------------------------------------------------------------------- */

/** One resolvable entity (user, team, stage, template, retailer, authority…). */
export interface ContextEntity {
  /** Registry this entity belongs to: "users" | "teams" | "stages" | "templates" | "retailers" | "authorities" | "programs" | "customers" | "tags". */
  registry: string;
  /** Platform id when known (instance-level ScopeRef id); null for category-only entries. */
  id: string | null;
  /** Display label. UNTRUSTED TENANT DATA — never treated as instructions. */
  label: string;
  /** Safe aliases that may resolve deterministically to this entity. */
  aliases?: string[];
  confidence: "verified" | "unconfirmed";
  privacy: PrivacyClass;
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

/** What a Brain session asks its provider for. */
export interface ContextRequest {
  profile: ContextProfileId;
  /** Purpose narrows retrieval: parsing needs vocabulary; consulting needs related workflows too. */
  purpose: "parse" | "consult" | "ghost-suggest" | "revise" | "review";
  /** Clause/cursor hints so the provider can rank and compact relevantly. */
  focusText?: string;
  /** Registries the caller actually needs; empty = provider defaults for the purpose. */
  registries?: string[];
  /** Existing rule being revised (workflow-revision / template-scoped profiles). */
  currentRule?: WorkflowRule | null;
  /** Hard byte budget for the serialized snapshot (provider must respect it). */
  maxBytes?: number;
}

export interface ContextSearchRequest {
  registry: string;
  query: string;
  limit?: number;
}

export interface ContextSearchResult {
  entities: ContextEntity[];
  /** True when results were cut by limit/budget — callers must not treat the list as exhaustive. */
  truncated: boolean;
}

export interface EntityResolutionRequest {
  registry: string;
  /** Author-written text. UNTRUSTED. */
  text: string;
}

export type EntityResolutionResult =
  | { kind: "exact"; entity: ContextEntity }
  | { kind: "alias"; entity: ContextEntity; alias: string }
  /** Multiple exact-label matches — must become a clarification, never a pick. */
  | { kind: "duplicate"; candidates: ContextEntity[] }
  /** Fuzzy candidates are SUGGESTIONS, never automatic substitutions. */
  | { kind: "suggestions"; candidates: ContextEntity[] }
  | { kind: "unknown" };

/* -------------------------------------------------------------------------- */
/* Snapshot                                                                   */
/* -------------------------------------------------------------------------- */

/** Where a vocabulary section came from and how fresh it is. */
export interface ContextSourceMeta {
  /** e.g. "static-vocabulary", "demo-seed", "workflows/templates", "products/fields". */
  source: string;
  /** Epoch ms the host fetched/derived the data (host clock; informational). */
  fetchedAt: number;
  /** Monotonic version the host assigns; bumping it invalidates dependents. */
  version: string;
}

export interface ContextBudget {
  maxBytes: number;
  usedBytes: number;
  /** Sections that were cut to fit, with what was dropped. Empty = complete. */
  truncated: Array<{ section: string; dropped: number; reason: string }>;
}

/** Summary of a related workflow, for duplicate/conflict analysis. */
export interface RelatedWorkflowSummary {
  id: string;
  name: string;
  enabled: boolean;
  events: string[];
  /** Condition field keys the workflow tests (for overlap detection). */
  conditionFields: string[];
  actions: string[];
}

/**
 * The versioned, bounded snapshot. `snapshotId` MUST change whenever the
 * profile, tenant, or any section version changes; every derived artifact
 * (AI results, ghost suggestions, recommendations) is keyed to it and becomes
 * stale when it changes.
 */
export interface BrainContextSnapshot {
  snapshotId: string;
  profile: ContextProfileId;
  identity: ContextIdentity;
  /** Stable content hash over the canonical serialization (see contextCompiler). */
  vocabularyHash: string;
  /** Live option lists per field key — same shape ParseOptions.instanceOptions takes. */
  instanceOptions: Record<string, string[]>;
  /** ID-bearing registries per field/action key — same shape ParseOptions.instanceRegistry takes. */
  instanceRegistry: Record<string, { id: string; label: string }[]>;
  /** Live assignee names — same shape ParseOptions.assignees takes. */
  assignees: string[];
  /** Full entity list per registry (bounded; see budget.truncated). */
  entities: ContextEntity[];
  relatedWorkflows: RelatedWorkflowSummary[];
  /** Actions the HOST allows this user/tenant to author. Empty = host default-deny decides downstream. */
  allowedActionKeys: string[];
  sources: ContextSourceMeta[];
  budget: ContextBudget;
  /** Highest privacy class present — controls what diagnostics may echo. */
  privacyCeiling: PrivacyClass;
}

/* -------------------------------------------------------------------------- */
/* Invalidation                                                               */
/* -------------------------------------------------------------------------- */

export interface ContextInvalidationEvent {
  /** Snapshot that is no longer current. */
  snapshotId: string;
  reason: "vocabulary-changed" | "tenant-switched" | "profile-switched" | "expired";
}
