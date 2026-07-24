/**
 * Brain context contract suite — the SHARED provider contract plus the
 * contextCompiler reference implementation.
 *
 * `runContextProviderContract` is exported for reuse: every
 * WorkflowBrainContextProvider (standalone demo, Landjourney live, the Wave-3
 * transplant parity test) must pass the same assertions — deterministic
 * snapshot ids, honest budgets, honest search truncation, resolution that
 * never guesses, and privacy/confidence stamped on every entity. Importing
 * this file runs nothing; executing it directly runs the suite against an
 * in-memory reference provider backed by compileContext +
 * staticVocabularySnapshot, then pins compiler-specific semantics.
 *
 * Suite preconditions a provider's seed data must meet (the reference
 * provider does): at least one entity whose label is unique in its registry,
 * at most 50 entities sharing any one label, and at least a quarter of the
 * unbounded snapshot's bytes in droppable sections (entities /
 * relatedWorkflows / instanceOptions) so the budget probe can bite.
 *
 * Run: npx tsx core-tests/assert-brain-context-contract.ts
 */
import {
  ContextCompilerInput,
  DEFAULT_CONTEXT_BUDGET_BYTES,
  compileContext,
  rankEntities,
  snapshotToParseOptions,
} from "../packages/workflow-brain/src/contextCompiler";
import { ContextEntity, ContextRequest } from "../packages/workflow-brain/src/context";
import { WorkflowBrainContextProvider } from "../packages/workflow-brain/src/ports";
import { staticVocabularySnapshot } from "../packages/rule-core/src/parserGrounding";
import { parseInstruction } from "../packages/rule-core/src/nlParser";
import { fuzzyMatches } from "../packages/rule-core/src/fuzzy";

/* ========================================================================== */
/* The reusable provider contract                                             */
/* ========================================================================== */

const PRIVACY_CLASSES = new Set(["public-vocabulary", "tenant-internal", "customer-data"]);
const CONFIDENCE_CLASSES = new Set(["verified", "unconfirmed"]);

/** Self-measurement slack: budgets are measured with `usedBytes` still 0, so the
 *  shipped serialization runs at most the digits of the final count over it. */
const BUDGET_TOLERANCE_BYTES = 16;

const byteLength = (text: string) => Buffer.byteLength(text, "utf8");
const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Assert the WorkflowBrainContextProvider contract against any implementation.
 * Prints PASS/FAIL lines prefixed with `name` and returns the failure count —
 * it never exits, so callers can compose providers into one run.
 */
export async function runContextProviderContract(
  name: string,
  makeProvider: () => WorkflowBrainContextProvider | Promise<WorkflowBrainContextProvider>
): Promise<{ failures: number }> {
  let failures = 0;
  const t = (label: string, cond: boolean, detail?: string) => {
    if (!cond) failures++;
    console.log(`${cond ? "PASS" : "FAIL"} [${name}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  };

  const provider = await makeProvider();
  const baseRequest: ContextRequest = { profile: provider.profile, purpose: "parse" };

  /* ---- getSnapshot: identity + determinism ------------------------------- */
  const snapA = await provider.getSnapshot(baseRequest);
  const snapB = await provider.getSnapshot(baseRequest);
  t("snapshotId non-empty", typeof snapA.snapshotId === "string" && snapA.snapshotId.length > 0);
  t("vocabularyHash non-empty", typeof snapA.vocabularyHash === "string" && snapA.vocabularyHash.length > 0);
  t("same request twice → identical snapshotId", snapA.snapshotId === snapB.snapshotId,
    `${snapA.snapshotId} vs ${snapB.snapshotId}`);
  t("snapshot profile matches the provider's", snapA.profile === provider.profile);
  t(
    "every entity carries privacy + confidence",
    snapA.entities.length > 0 &&
      snapA.entities.every(
        (e) => PRIVACY_CLASSES.has(e.privacy) && CONFIDENCE_CLASSES.has(e.confidence)
      )
  );

  /* ---- budget ------------------------------------------------------------ */
  const fullBytes = byteLength(JSON.stringify(snapA));
  const tinyMax = Math.max(512, Math.ceil(fullBytes * 0.75));
  const tiny = await provider.getSnapshot({ ...baseRequest, maxBytes: tinyMax });
  const tinyBytes = byteLength(JSON.stringify(tiny));
  t("tight budget → truncation recorded", tiny.budget.truncated.length > 0);
  t("budget echoes the requested maxBytes", tiny.budget.maxBytes === tinyMax);
  t(
    "serialized snapshot fits maxBytes (+ documented slack)",
    tinyBytes <= tinyMax + BUDGET_TOLERANCE_BYTES,
    `${tinyBytes} > ${tinyMax} + ${BUDGET_TOLERANCE_BYTES}`
  );
  t(
    "budget.usedBytes honest about the serialized size",
    Math.abs(tiny.budget.usedBytes - tinyBytes) <= BUDGET_TOLERANCE_BYTES,
    `usedBytes=${tiny.budget.usedBytes} actual=${tinyBytes}`
  );

  /* ---- search ------------------------------------------------------------ */
  const labelCount = new Map<string, number>();
  for (const e of snapA.entities) {
    const key = `${e.registry} ${norm(e.label)}`;
    labelCount.set(key, (labelCount.get(key) ?? 0) + 1);
  }
  const unique = snapA.entities.find((e) => labelCount.get(`${e.registry} ${norm(e.label)}`) === 1);
  t("suite precondition: a unique-labeled entity exists", !!unique);
  if (unique) {
    const wide = await provider.search({ registry: unique.registry, query: unique.label, limit: 50 });
    t("search stays inside the requested registry", wide.entities.every((e) => e.registry === unique.registry));
    t("search finds the seeded entity by label", wide.entities.some((e) => e.label === unique.label));
    const narrow = await provider.search({ registry: unique.registry, query: unique.label, limit: 1 });
    t("search respects limit", narrow.entities.length <= 1);
    t(
      "search truncated flag is honest",
      narrow.truncated
        ? wide.entities.length > narrow.entities.length
        : wide.entities.length === narrow.entities.length,
      `truncated=${narrow.truncated} narrow=${narrow.entities.length} wide=${wide.entities.length}`
    );

    /* ---- resolveEntity --------------------------------------------------- */
    const exact = await provider.resolveEntity({ registry: unique.registry, text: unique.label });
    t("resolveEntity: exact label → exact", exact.kind === "exact" && exact.entity.label === unique.label,
      JSON.stringify(exact));
    const flipped = await provider.resolveEntity({
      registry: unique.registry,
      text: ` ${unique.label.toUpperCase()} `,
    });
    t("resolveEntity: case/whitespace-insensitive exact", flipped.kind === "exact");
  }
  const garbage = await provider.resolveEntity({
    registry: snapA.entities[0]?.registry ?? "users",
    text: "zzqx totally unknown 424242",
  });
  t(
    "resolveEntity: garbage → unknown/suggestions, NEVER exact",
    garbage.kind === "unknown" || garbage.kind === "suggestions",
    garbage.kind
  );

  /* ---- duplicates (asserted when the seed carries a duplicate pair) ------ */
  const dup = snapA.entities.find((e) => (labelCount.get(`${e.registry} ${norm(e.label)}`) ?? 0) > 1);
  if (dup) {
    const resolved = await provider.resolveEntity({ registry: dup.registry, text: dup.label });
    t(
      "resolveEntity: duplicate label → duplicate with all candidates (never a pick)",
      resolved.kind === "duplicate" && resolved.candidates.length >= 2,
      JSON.stringify(resolved)
    );
  }

  return { failures };
}

/* ========================================================================== */
/* In-memory reference provider (compileContext + static vocabulary + seeds)  */
/* ========================================================================== */

function seedEntities(): ContextEntity[] {
  const seeded: ContextEntity[] = [
    { registry: "users", id: "u-wael", label: "Wael", aliases: ["W. Hassan"], confidence: "verified", privacy: "tenant-internal" },
    { registry: "users", id: "u-sara", label: "Sara", confidence: "verified", privacy: "tenant-internal" },
    // Deliberate duplicate label pair — two real people, one name.
    { registry: "users", id: "u-alex-1", label: "Alex Chen", confidence: "verified", privacy: "tenant-internal" },
    { registry: "users", id: "u-alex-2", label: "Alex Chen", confidence: "unconfirmed", privacy: "tenant-internal" },
    { registry: "retailers", id: "r-growmark", label: "Growmark", confidence: "verified", privacy: "tenant-internal" },
    { registry: "retailers", id: "r-fcs", label: "FCS Financial", confidence: "verified", privacy: "tenant-internal" },
    { registry: "stages", id: "st-processing", label: "Processing", confidence: "verified", privacy: "public-vocabulary" },
  ];
  // Ballast so the budget probe has plenty of droppable mass.
  for (let i = 0; i < 40; i++) {
    seeded.push({
      registry: "customers",
      id: `c-${String(i).padStart(2, "0")}`,
      label: `Seed Customer ${String(i).padStart(2, "0")}`,
      confidence: "unconfirmed",
      privacy: "customer-data",
    });
  }
  return seeded;
}

const USER_REGISTRY = [
  { id: "u-wael", label: "Wael" },
  { id: "u-sara", label: "Sara" },
  { id: "u-alex-1", label: "Alex Chen" },
  { id: "u-alex-2", label: "Alex Chen" },
];

function referenceInput(overrides: Partial<ContextCompilerInput> = {}): ContextCompilerInput {
  const vocab = staticVocabularySnapshot();
  return {
    identity: { tenantKey: "demo-tenant" },
    profile: "standalone-demo",
    entities: seedEntities(),
    relatedWorkflows: [
      { id: "wf-1", name: "Booking error escalation", enabled: true, events: ["SYSTEM ERROR"], conditionFields: ["bookstatus"], actions: ["assign_user"] },
      { id: "wf-2", name: "Large loan review", enabled: false, events: ["LOAN APPROVED"], conditionFields: ["loan_amount"], actions: ["assign_user"] },
    ],
    instanceOptions: { ...vocab.instanceOptions, retailer: ["Growmark", "FCS Financial"] },
    instanceRegistry: {
      assign_user: USER_REGISTRY.map((e) => ({ ...e })),
      notify: USER_REGISTRY.map((e) => ({ ...e })),
      retailer: [
        { id: "r-growmark", label: "Growmark" },
        { id: "r-fcs", label: "FCS Financial" },
      ],
    },
    assignees: [...vocab.assignees],
    allowedActionKeys: ["assign_user", "notify", "add_tag", "change_stage"],
    sources: [
      { source: "static-vocabulary", fetchedAt: 0, version: "static" },
      { source: "demo-seed", fetchedAt: 0, version: "seed-1" },
    ],
    ...overrides,
  };
}

/** Reference provider: every port answered from compileContext + the seed. */
function makeReferenceProvider(
  input: ContextCompilerInput = referenceInput()
): WorkflowBrainContextProvider {
  return {
    profile: input.profile,
    async getSnapshot(request) {
      return compileContext(input, request);
    },
    async search(request) {
      const limit = Math.max(0, request.limit ?? 20);
      const q = norm(request.query);
      const matches = input.entities.filter(
        (e) =>
          e.registry === request.registry &&
          (q === "" ||
            norm(e.label).includes(q) ||
            (e.aliases ?? []).some((alias) => norm(alias).includes(q)))
      );
      return { entities: matches.slice(0, limit), truncated: matches.length > limit };
    },
    async resolveEntity(request) {
      const inRegistry = input.entities.filter((e) => e.registry === request.registry);
      const text = norm(request.text);
      const exact = inRegistry.filter((e) => norm(e.label) === text);
      if (exact.length > 1) return { kind: "duplicate", candidates: exact };
      if (exact.length === 1) return { kind: "exact", entity: exact[0] };
      for (const entity of inRegistry) {
        const alias = (entity.aliases ?? []).find((a) => norm(a) === text);
        if (alias !== undefined) return { kind: "alias", entity, alias };
      }
      const labels = fuzzyMatches(request.text, inRegistry.map((e) => e.label));
      if (labels.length > 0) {
        const candidates = labels
          .map((label) => inRegistry.find((e) => e.label === label))
          .filter((e): e is ContextEntity => !!e);
        return { kind: "suggestions", candidates };
      }
      return { kind: "unknown" };
    },
  };
}

/* ========================================================================== */
/* Direct execution: contract suite + compiler-specific assertions            */
/* ========================================================================== */

async function main(): Promise<number> {
  let failures = 0;
  const t = (label: string, cond: boolean, detail?: string) => {
    if (!cond) failures++;
    console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  };

  const suite = await runContextProviderContract("reference-provider", () => makeReferenceProvider());
  failures += suite.failures;

  const request: ContextRequest = { profile: "standalone-demo", purpose: "parse" };
  const snapshot = compileContext(referenceInput(), request);

  /* ---- identity keying ---------------------------------------------------- */
  t("snapshotId is ctx-<8 hex>", /^ctx-[0-9a-f]{8}$/.test(snapshot.snapshotId), snapshot.snapshotId);
  t(
    "snapshotId changes when a source.version changes",
    compileContext(
      referenceInput({
        sources: [
          { source: "static-vocabulary", fetchedAt: 0, version: "static" },
          { source: "demo-seed", fetchedAt: 0, version: "seed-2" },
        ],
      }),
      request
    ).snapshotId !== snapshot.snapshotId
  );
  t(
    "snapshotId changes when the profile changes",
    compileContext(referenceInput({ profile: "workflow-revision" }), request).snapshotId !==
      snapshot.snapshotId
  );
  t(
    "snapshotId changes when the tenantKey changes",
    compileContext(referenceInput({ identity: { tenantKey: "other-tenant" } }), request).snapshotId !==
      snapshot.snapshotId
  );
  t(
    "snapshotId ignores host clock metadata (fetchedAt)",
    compileContext(
      referenceInput({
        sources: [
          { source: "static-vocabulary", fetchedAt: 999999, version: "static" },
          { source: "demo-seed", fetchedAt: 888888, version: "seed-1" },
        ],
      }),
      request
    ).snapshotId === snapshot.snapshotId
  );
  t(
    "vocabularyHash changes when an option is added",
    compileContext(
      referenceInput({
        instanceOptions: {
          ...referenceInput().instanceOptions,
          retailer: ["Growmark", "FCS Financial", "New Coop"],
        },
      }),
      request
    ).vocabularyHash !== snapshot.vocabularyHash
  );

  /* ---- dedupe + privacy ceiling ------------------------------------------- */
  const withDupes = referenceInput();
  withDupes.entities = [...withDupes.entities, ...seedEntities()]; // every seed twice
  t(
    "entities deduped on (registry, id, label)",
    compileContext(withDupes, request).entities.length === snapshot.entities.length
  );
  t(
    "duplicate LABELS with distinct ids both survive dedupe",
    snapshot.entities.filter((e) => e.label === "Alex Chen").length === 2
  );
  t("privacyCeiling = max class present (customer-data)", snapshot.privacyCeiling === "customer-data");
  const usersOnly = compileContext(referenceInput(), { ...request, registries: ["users"] });
  t(
    "registries filter narrows entities",
    usersOnly.entities.length > 0 && usersOnly.entities.every((e) => e.registry === "users")
  );
  t("privacyCeiling follows the filtered content", usersOnly.privacyCeiling === "tenant-internal");

  /* ---- ranking ------------------------------------------------------------ */
  const focusRanked = rankEntities(
    seedEntities(),
    "when a loan is approved, assign to wael",
    seedEntities().length
  );
  t("rank: focus substring match first", focusRanked[0]?.label === "Wael");
  t(
    "rank: registry evidence lifts siblings over unrelated registries",
    focusRanked.findIndex((e) => e.label === "Sara") <
      focusRanked.findIndex((e) => e.label === "Growmark")
  );
  const noFocusA = rankEntities(seedEntities(), undefined, 5);
  const noFocusB = rankEntities([...seedEntities()].reverse(), undefined, 5);
  t(
    "rank: no focus → deterministic (registry, label) order regardless of input order",
    JSON.stringify(noFocusA) === JSON.stringify(noFocusB)
  );
  t("rank: limit respected", rankEntities(seedEntities(), "wael", 2).length === 2);
  t("rank: limit 0 → empty", rankEntities(seedEntities(), "wael", 0).length === 0);

  /* ---- budget internals ---------------------------------------------------- */
  t("default budget is 32 KiB", DEFAULT_CONTEXT_BUDGET_BYTES === 32768);
  const fullBytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
  const squeezed = compileContext(referenceInput(), { ...request, maxBytes: Math.ceil(fullBytes * 0.8) });
  t(
    "drop order starts with entities (rank tail first)",
    squeezed.budget.truncated[0]?.section === "entities" && squeezed.budget.truncated[0].dropped > 0,
    JSON.stringify(squeezed.budget.truncated)
  );
  t(
    "unbounded compile reports no truncation",
    snapshot.budget.truncated.length === 0 && snapshot.budget.usedBytes <= DEFAULT_CONTEXT_BUDGET_BYTES
  );

  /* ---- parse-options projection + round-trip ------------------------------ */
  const options = snapshotToParseOptions(snapshot, { forceEvent: "LOAN APPROVED", allowUnbackedValues: true });
  t(
    "snapshotToParseOptions preserves base forceEvent/allowUnbackedValues",
    options.forceEvent === "LOAN APPROVED" && options.allowUnbackedValues === true
  );
  t(
    "snapshotToParseOptions projects assignees/options/registry from the snapshot",
    JSON.stringify(options.assignees) === JSON.stringify(snapshot.assignees) &&
      JSON.stringify(options.instanceOptions) === JSON.stringify(snapshot.instanceOptions) &&
      JSON.stringify(options.instanceRegistry) === JSON.stringify(snapshot.instanceRegistry)
  );
  t(
    "projection is defensive (mutating options never touches the snapshot)",
    (() => {
      const probe = snapshotToParseOptions(snapshot);
      probe.assignees?.push("Intruder");
      probe.instanceRegistry?.assign_user?.push({ id: "u-evil", label: "Intruder" });
      return (
        !snapshot.assignees.includes("Intruder") &&
        !snapshot.instanceRegistry.assign_user.some((e) => e.id === "u-evil")
      );
    })()
  );
  const roundTrip = parseInstruction(
    "When a loan is approved, assign to Wael",
    snapshotToParseOptions(snapshot)
  );
  t(
    "round-trip: snapshot registry resolves the assignee to an instance ScopeRef",
    JSON.stringify(roundTrip.rule?.actions[0]?.params.assignee) ===
      '{"level":"instance","id":"u-wael","label":"Wael"}',
    JSON.stringify(roundTrip.rule?.actions[0])
  );
  t(
    "round-trip: parse is clean (no unresolved/uncovered)",
    roundTrip.unresolved.length === 0 && roundTrip.uncovered.length === 0
  );

  return failures;
}

// Run only when executed directly (npx tsx core-tests/assert-brain-context-contract.ts);
// importing the suite for another provider must stay side-effect free.
const executedDirectly =
  typeof process !== "undefined" &&
  typeof process.argv[1] === "string" &&
  /assert-brain-context-contract\.(ts|js|mts|mjs|cts|cjs)$/.test(process.argv[1]);

if (executedDirectly) {
  main().then(
    (failures) => {
      if (failures > 0) {
        console.error(`\n✗ assert-brain-context-contract: ${failures} failure(s).`);
        process.exit(1);
      }
      console.log("\n✓ context provider contract + compiler semantics hold.");
    },
    (error) => {
      console.error("✗ assert-brain-context-contract crashed:", error);
      process.exit(1);
    }
  );
}
