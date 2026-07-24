/**
 * GENERATED from packages/workflow-brain/src/contextCompiler.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/workflow-brain contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
/**
 * contextCompiler — turns host-supplied raw context into the bounded, ranked,
 * deterministic BrainContextSnapshot every provider hands the Brain.
 *
 * The compiler is the shared engine behind WorkflowBrainContextProvider
 * implementations: dedupe entities, rank them against the request's focus text
 * with a fixed scoring ladder, enforce the byte budget with per-section
 * truncation reports, and mint content-derived identifiers. `snapshotId` and
 * `vocabularyHash` are pure functions of the inputs — no clock reads, no
 * randomness — so the same context compiled twice is byte-for-byte the same
 * snapshot, and every derived artifact keyed to it stays verifiable.
 *
 * Tenant strings (labels, aliases, workflow names) are DATA: they are ranked,
 * measured, and copied — never interpreted, never interpolated into anything
 * executable.
 */
import {
  BrainContextSnapshot,
  ContextBudget,
  ContextEntity,
  ContextIdentity,
  ContextProfileId,
  ContextRequest,
  ContextSourceMeta,
  PrivacyClass,
  RelatedWorkflowSummary,
} from "./context";
import { stableVocabularyHash } from "../core/parserGrounding";
import type { ParseOptions } from "../core/nlParser";

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

/** Everything a host adapter gathers before compilation. All fields are raw:
 *  unbounded, unranked, possibly duplicated — the compiler owns the shaping. */
export interface ContextCompilerInput {
  identity: ContextIdentity;
  profile: ContextProfileId;
  entities: ContextEntity[];
  relatedWorkflows: RelatedWorkflowSummary[];
  instanceOptions: Record<string, string[]>;
  instanceRegistry: Record<string, { id: string; label: string }[]>;
  assignees: string[];
  allowedActionKeys: string[];
  sources: ContextSourceMeta[];
}

/**
 * Default hard budget for a serialized snapshot: 32 KiB. The full static
 * vocabulary projection serializes to roughly 6 KiB, so the default leaves
 * room for a few hundred ranked entities (~100 bytes apiece) plus related
 * workflow summaries, while staying cheap to re-serialize on every keystroke
 * and small enough to ride inside one parse request body without dwarfing the
 * instruction it accompanies.
 */
export const DEFAULT_CONTEXT_BUDGET_BYTES = 32768;

/* -------------------------------------------------------------------------- */
/* Deterministic primitives                                                   */
/* -------------------------------------------------------------------------- */

/** FNV-1a 32-bit — intentionally the same primitive parserGrounding hashes with. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hashHex(text: string): string {
  return fnv1a(text).toString(16).padStart(8, "0");
}

/** UTF-8 byte length without host encoders — budgets measure bytes, not chars. */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i) as number;
    if (code > 0xffff) i++; // surrogate pair consumed
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Locale-independent string order (plain code-unit comparison). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Lowercased word tokens of length ≥ 2 — single letters are noise, not evidence. */
function wordsOf(text: string): string[] {
  return normText(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2);
}

/* -------------------------------------------------------------------------- */
/* Ranking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic relevance ranking against the focus text. Scoring ladder:
 *
 *   3 — the entity's label (or an alias) appears verbatim inside the focus
 *       text (normalized substring; labels shorter than 2 chars are skipped);
 *   2 — the label/alias shares at least one word (≥ 2 chars) with the focus;
 *   1 — a sibling of the same registry earned textual evidence above, so the
 *       registry itself is in play;
 *   0 — nothing links the entity to the focus.
 *
 * Ties break on (registry, label, id) code-unit order — no randomness, no
 * input-order dependence beyond the ladder itself.
 */
export function rankEntities(
  entities: ContextEntity[],
  focusText: string | undefined,
  limit: number
): ContextEntity[] {
  const max = Math.max(0, Math.floor(limit));
  const focus = normText(focusText ?? "");
  const focusWords = new Set(wordsOf(focus));

  const scored = entities.map((entity) => {
    let textScore = 0;
    if (focus) {
      for (const raw of [entity.label, ...(entity.aliases ?? [])]) {
        const label = normText(raw);
        if (label.length >= 2 && focus.includes(label)) {
          textScore = 3;
          break;
        }
        if (textScore < 2 && wordsOf(raw).some((word) => focusWords.has(word))) {
          textScore = 2;
        }
      }
    }
    return { entity, textScore, score: 0 };
  });

  const evidenced = new Set(
    scored.filter((item) => item.textScore > 0).map((item) => item.entity.registry)
  );
  for (const item of scored) {
    item.score = item.textScore > 0 ? item.textScore : evidenced.has(item.entity.registry) ? 1 : 0;
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        compareText(a.entity.registry, b.entity.registry) ||
        compareText(a.entity.label, b.entity.label) ||
        compareText(a.entity.id ?? "", b.entity.id ?? "")
    )
    .slice(0, max)
    .map((item) => item.entity);
}

/* -------------------------------------------------------------------------- */
/* Compilation                                                                */
/* -------------------------------------------------------------------------- */

const PRIVACY_RANK: Record<PrivacyClass, number> = {
  "public-vocabulary": 0,
  "tenant-internal": 1,
  "customer-data": 2,
};

/**
 * Compile raw host context into a bounded snapshot.
 *
 * Budget semantics: the serialized snapshot (its own `budget.usedBytes` field
 * measured as 0 — the count cannot contain itself) must fit
 * `request.maxBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES`. Sections are cut in a
 * fixed drop order — entities from the rank tail, then relatedWorkflows from
 * the tail, then whole instanceOptions keys in reverse key order — and every
 * cut is recorded in `budget.truncated`. The shipped serialization therefore
 * runs at most the digits of `usedBytes` (≤ 16 bytes) over the measurement;
 * consumers get that documented slack, never silent overflow. If the
 * irreducible sections alone exceed the budget, a zero-drop "snapshot" record
 * says so instead of pretending to fit.
 */
export function compileContext(
  input: ContextCompilerInput,
  request: ContextRequest
): BrainContextSnapshot {
  const maxBytes = Math.max(1, Math.floor(request.maxBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES));

  // Dedupe on (registry, id, label), first appearance wins.
  const seen = new Set<string>();
  const deduped: ContextEntity[] = [];
  for (const entity of input.entities) {
    const key = `${entity.registry} ${entity.id ?? ""} ${entity.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entity);
  }

  // Registries filter: an empty/absent list means provider defaults, i.e.
  // everything the host handed over.
  const wanted =
    request.registries && request.registries.length > 0 ? new Set(request.registries) : null;
  const scoped = wanted ? deduped.filter((entity) => wanted.has(entity.registry)) : deduped;

  const keptEntities = rankEntities(scoped, request.focusText, scoped.length);
  const keptWorkflows = input.relatedWorkflows.map((workflow) => ({ ...workflow }));
  const keptOptions: Record<string, string[]> = {};
  for (const key of Object.keys(input.instanceOptions)) {
    keptOptions[key] = [...input.instanceOptions[key]];
  }

  const truncated: ContextBudget["truncated"] = [];
  const budget: ContextBudget = { maxBytes, usedBytes: 0, truncated };

  // Hash/id/ceiling placeholders share the final field lengths ("v-" + 8 hex,
  // "ctx-" + 8 hex, longest privacy class), so trimming measures a size the
  // real values can only match or shrink.
  const draft: BrainContextSnapshot = {
    snapshotId: "ctx-00000000",
    profile: input.profile,
    identity: input.identity,
    vocabularyHash: "v-00000000",
    instanceOptions: keptOptions,
    instanceRegistry: input.instanceRegistry,
    assignees: [...input.assignees],
    entities: keptEntities,
    relatedWorkflows: keptWorkflows,
    allowedActionKeys: [...input.allowedActionKeys],
    sources: input.sources.map((source) => ({ ...source })),
    budget,
    privacyCeiling: "public-vocabulary",
  };

  const over = () => utf8ByteLength(JSON.stringify(draft)) > maxBytes;

  const trimTail = (section: string, items: unknown[]) => {
    if (!over() || items.length === 0) return;
    const record = { section, dropped: 0, reason: "byte-budget" };
    truncated.push(record);
    while (over() && items.length > 0) {
      items.pop();
      record.dropped++;
    }
  };
  trimTail("entities", keptEntities);
  trimTail("relatedWorkflows", keptWorkflows);

  if (over()) {
    const keys = Object.keys(keptOptions).sort(compareText).reverse();
    if (keys.length > 0) {
      const record = { section: "instanceOptions", dropped: 0, reason: "byte-budget" };
      truncated.push(record);
      for (const key of keys) {
        if (!over()) break;
        record.dropped += keptOptions[key].length;
        delete keptOptions[key];
      }
    }
  }
  if (over()) {
    truncated.push({ section: "snapshot", dropped: 0, reason: "irreducible sections exceed maxBytes" });
  }

  // Vocabulary hash over the canonical vocab projection of what SURVIVED the
  // budget — the hash certifies the vocabulary the Brain will actually see.
  const vocabularyHash = stableVocabularyHash({
    events: [],
    fields: [],
    actions: [...input.allowedActionKeys],
    operatorsByKind: {},
    instanceOptions: keptOptions,
    instanceRegistry: input.instanceRegistry,
    assignees: draft.assignees,
    source: "context-compiler",
    version: "1",
  });
  draft.vocabularyHash = vocabularyHash;

  // snapshotId: profile + tenant + vocabulary content + every source version.
  // Source names ride along so two sources swapping versions can't collide.
  // fetchedAt is deliberately excluded — identity derives from content and
  // versions, never from when a host clock observed them.
  const idMaterial = [
    input.profile,
    input.identity.tenantKey,
    vocabularyHash,
    ...input.sources.map((source) => `${source.source}@${source.version}`),
  ].join(" ");
  draft.snapshotId = `ctx-${hashHex(idMaterial)}`;

  let ceiling: PrivacyClass = "public-vocabulary";
  for (const entity of keptEntities) {
    if (PRIVACY_RANK[entity.privacy] > PRIVACY_RANK[ceiling]) ceiling = entity.privacy;
  }
  draft.privacyCeiling = ceiling;

  budget.usedBytes = utf8ByteLength(JSON.stringify(draft)); // usedBytes itself still 0 here
  return draft;
}

/* -------------------------------------------------------------------------- */
/* Parser projection                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Project a snapshot straight into ParseOptions. Assignees, instanceOptions
 * and instanceRegistry come from the snapshot (defensively copied — parsers
 * must not be able to mutate a shared snapshot); everything else on `base`
 * (forceEvent, allowUnbackedValues, …) is preserved untouched.
 */
export function snapshotToParseOptions(
  snapshot: BrainContextSnapshot,
  base?: ParseOptions
): ParseOptions {
  const options: ParseOptions = { ...(base ?? {}) };
  options.assignees = [...snapshot.assignees];
  options.instanceOptions = {};
  for (const key of Object.keys(snapshot.instanceOptions)) {
    options.instanceOptions[key] = [...snapshot.instanceOptions[key]];
  }
  options.instanceRegistry = {};
  for (const key of Object.keys(snapshot.instanceRegistry)) {
    options.instanceRegistry[key] = snapshot.instanceRegistry[key].map((entry) => ({ ...entry }));
  }
  return options;
}
