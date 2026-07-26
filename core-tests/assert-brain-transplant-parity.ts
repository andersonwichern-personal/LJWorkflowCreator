/**
 * assert-brain-transplant-parity — the Landjourney-live adapter behind a
 * deterministic mock transport passes the SAME provider contract as the
 * standalone adapter, and the two adapters are parse-parity: seeded with
 * semantically equivalent registries, the same authoring text produces the
 * same semantic core (trigger/condition/action multisets) through
 * snapshotToParseOptions → parseInstruction.
 *
 * Also pins the fail-closed ladder (failing registry → EMPTY + "unavailable",
 * capability off → nothing fetched at all), tolerant response mapping
 * (wrapped/bare shapes, malformed rows skipped, ids never invented), tenant
 * identity keying, and abort propagation.
 *
 * MockLiveTransport + the fixture builders are exported for reuse by
 * assert-brain-context-switch.ts; importing this file runs nothing.
 *
 * Run: npx tsx core-tests/assert-brain-transplant-parity.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runContextProviderContract } from './assert-brain-context-contract';
import {
  LandjourneyBrainContextProvider,
  LiveContextTransport,
  REGISTRY_ENDPOINTS,
} from '../src/app/features/workflows/data/landjourney-brain-context.adapter';
import { StandaloneBrainContextProvider } from '../src/app/features/workflows/data/standalone-brain-context.adapter';
import { snapshotToParseOptions } from '../src/app/brain/contextCompiler';
import { HostCapabilityPort } from '../src/app/brain/ports';
import { ParseResult, parseInstruction } from '../src/app/core/nlParser';
import { condFieldKey, isScopeRef } from '../src/app/core/vocabulary';

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
}

/* ========================================================================== */
/* Mock transport + fixtures (exported for the context-switch suite)          */
/* ========================================================================== */

export function endpointKey(registry: string): string {
  const endpoint = REGISTRY_ENDPOINTS.find((row) => row.registry === registry);
  if (!endpoint) throw new Error(`no endpoint for registry ${registry}`);
  return `${endpoint.service} ${endpoint.path}`;
}

/** Deterministic transport: fixtures keyed by "<service> <path>". */
export class MockLiveTransport implements LiveContextTransport {
  readonly calls: string[] = [];
  constructor(
    private readonly fixtures: Record<string, unknown>,
    private readonly failing: ReadonlySet<string> = new Set()
  ) {}
  async get<T>(service: string, path: string, signal?: AbortSignal): Promise<T> {
    const key = `${service} ${path}`;
    this.calls.push(key);
    if (signal?.aborted) throw new Error(`aborted: ${key}`);
    if (this.failing.has(key)) throw new Error(`503 ${key}`);
    if (!(key in this.fixtures)) throw new Error(`404 ${key}`);
    return JSON.parse(JSON.stringify(this.fixtures[key])) as T;
  }
}

export const CAPS_ON: HostCapabilityPort = { has: (c) => c === 'live-vocabulary' };
export const CAPS_OFF: HostCapabilityPort = { has: () => false };

/**
 * Registries semantically equivalent to the standalone adapter's demo
 * vocabulary: every static ASSIGNEE except the deliberately demo-only
 * "Layla", now with platform ids, spread across plausible Landjourney
 * response shapes (bare array / {items} / {data} / {content} wrappers).
 * Includes one malformed users row (no label) and one bare-string row —
 * both must be skipped, never fabricated into entities.
 */
export function liveFixtures(): Record<string, unknown> {
  return {
    [endpointKey('users')]: {
      items: [
        { id: 'u-wael', name: 'Wael' },
        { id: 'u-sara', name: 'Sara' },
        { id: 'u-mohammed', name: 'Mohammed' },
        { id: 'u-aisha', name: 'Aisha' },
        { id: 'u-omar', name: 'Omar' },
        { id: 'u-marisol', name: 'Marisol Vega' },
        // Duplicate label pair — two real people, one name (contract dup path).
        { id: 'u-jordan-1', name: 'Jordan Reyes' },
        { id: 'u-jordan-2', name: 'Jordan Reyes' },
        { id: 'u-broken' }, // malformed: no label — must be skipped
        'not-an-object', // malformed row shape — must be skipped
      ],
    },
    [endpointKey('teams')]: {
      data: [
        { id: 't-under', label: 'Underwriting Team' },
        { id: 't-booking', label: 'Booking Team' },
        { id: 't-escalation', label: 'Escalation Team' },
        { id: 't-operations', label: 'Operations Team' },
      ],
    },
    [endpointKey('stages')]: [
      { uuid: 'st-initiated', title: 'Initiated' },
      { uuid: 'st-processing', title: 'Processing' },
      { uuid: 'st-approved', title: 'Approved' },
      { uuid: 'st-closed', title: 'Closed' },
    ],
    [endpointKey('templates')]: {
      version: '2026-07-15', // API-stamped version — must land in sources
      items: [
        { uuid: 'tpl-orig', title: 'Origination' },
        { uuid: 'tpl-loanapp', title: 'Loan Application' },
        { uuid: 'tpl-covenant', title: 'Covenant' },
      ],
    },
    [endpointKey('forms')]: {
      content: [
        { uuid: 'form-crop', title: 'Crop Details' },
        { uuid: 'form-questionnaire', title: 'Yes/No Questionnaire' },
        { uuid: 'form-borrower', title: 'Borrower Profile' },
      ],
    },
    [endpointKey('fields')]: {
      rows: [
        { id: 'fld-crop-details', name: 'Crop Details' },
        { id: 'fld-yes-no-questionnaire', name: 'Yes/No Questionnaire' },
        { id: 'fld-acreage', name: 'Acreage' },
        { id: 'fld-yield', name: 'Yield' },
      ],
    },
    [endpointKey('authorities')]: [
      { id: 'auth-credit', label: 'Credit Committee' },
      { id: 'auth-branch', label: 'Branch Manager' },
    ],
    [endpointKey('retailers')]: {
      data: [
        { id: 'r-growmark', name: 'Growmark' },
        { id: 'r-fcs', name: 'FCS Financial' },
        { id: 'r-newcoop', name: 'New Coop' },
      ],
    },
    // NOTE: 'programs' deliberately has no fixture in the base transport — see
    // makeBaseTransport: it is the "one failing registry" of the spec.
  };
}

/** Base transport: full fixtures, programs registry failing (503). */
export function makeBaseTransport(): MockLiveTransport {
  return new MockLiveTransport(liveFixtures(), new Set([endpointKey('programs')]));
}

export function makeLiveProvider(
  tenantKey: string,
  transport: MockLiveTransport = makeBaseTransport(),
  capabilities: HostCapabilityPort = CAPS_ON
): LandjourneyBrainContextProvider {
  return new LandjourneyBrainContextProvider({ transport, tenantKey, capabilities });
}

/* ========================================================================== */
/* Semantic core — label-normalized trigger/condition/action multisets        */
/* ========================================================================== */

/** ScopeRef → its label; bare strings pass through. Same business meaning. */
function labelOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && isScopeRef(value)) return value.label;
  return JSON.stringify(value);
}

function multiset(items: string[]): string[] {
  return [...items].sort();
}

/** The parts of a parse that carry business meaning, id-representation aside. */
export function semanticCore(result: ParseResult): string {
  const rule = result.rule;
  const leaves: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record['children'])) {
      for (const child of record['children']) walk(child);
      return;
    }
    if (record['field'] !== undefined) {
      leaves.push(
        `${condFieldKey(record['field'] as never)} ${String(record['operator'])} ${labelOf(record['value'])}`
      );
    }
  };
  walk(rule?.conditions ?? null);
  return JSON.stringify({
    triggers: multiset((rule?.triggers ?? []).map((trigger) => trigger.event)),
    conditions: multiset(leaves),
    actions: multiset(
      (rule?.actions ?? []).map((action) => {
        const params = Object.keys(action.params)
          .sort()
          .map((key) => `${key}=${labelOf(action.params[key])}`)
          .join(' ');
        return `${action.action} ${params}`.trim();
      })
    ),
    unresolvedParams: multiset(result.unresolved.map((slot) => `${slot.where}:${slot.param ?? ''}`)),
  });
}

/* ========================================================================== */
/* Suite                                                                      */
/* ========================================================================== */

async function main(): Promise<number> {
  /* ---- 0. Static contracts on the adapter file --------------------------- */
  const adapterSource = readFileSync(
    fileURLToPath(
      new URL('../src/app/features/workflows/data/landjourney-brain-context.adapter.ts', import.meta.url)
    ),
    'utf8'
  );
  t('adapter is a plain class: zero Angular imports', !/@angular/.test(adapterSource));
  t('adapter never hand-rolls fetch (transport is the only seam)', !/\bfetch\(/.test(adapterSource));
  t(
    'endpoint table covers every spec registry exactly once',
    ['users', 'teams', 'stages', 'templates', 'forms', 'fields', 'authorities', 'retailers', 'programs'].every(
      (registry) => REGISTRY_ENDPOINTS.filter((row) => row.registry === registry).length === 1
    ) && REGISTRY_ENDPOINTS.length === 9
  );
  t(
    'CONFIRMED rows are exactly the repo-evidenced three (templates/forms/fields)',
    REGISTRY_ENDPOINTS.filter((row) => row.status === 'confirmed')
      .map((row) => row.registry)
      .sort()
      .join(',') === 'fields,forms,templates'
  );
  t(
    'every endpoint path is service-prefixed ApiService shape',
    REGISTRY_ENDPOINTS.every(
      (row) =>
        row.path.startsWith('/') && ['workflows', 'documents', 'products', 'iam', 'data'].includes(row.service)
    )
  );

  /* ---- 1. Shared provider contract (the SAME suite standalone passes) ---- */
  const contract = await runContextProviderContract('landjourney-live(mock)', () =>
    makeLiveProvider('sweetbank')
  );
  failures += contract.failures;

  /* ---- 2. Tolerant mapping + fail-closed degradation --------------------- */
  const live = makeLiveProvider('sweetbank');
  const liveSnap = await live.getSnapshot({ profile: 'landjourney-live', purpose: 'parse' });
  t('live snapshot carries the landjourney-live profile + ctor tenantKey',
    liveSnap.profile === 'landjourney-live' && liveSnap.identity.tenantKey === 'sweetbank');
  t(
    'wrapped ({items}/{data}/{content}/{rows}) and bare-array responses all map',
    ['users', 'teams', 'stages', 'templates', 'forms', 'fields', 'authorities', 'retailers'].every(
      (registry) => liveSnap.entities.some((entity) => entity.registry === registry)
    )
  );
  t(
    'malformed rows are skipped, never fabricated (no label ⇒ no entity)',
    !liveSnap.entities.some((entity) => entity.id === 'u-broken') &&
      liveSnap.entities.every((entity) => entity.label.trim().length > 0)
  );
  t(
    'ids are registry-issued only — every instanceRegistry id exists in the fixtures',
    Object.values(liveSnap.instanceRegistry)
      .flat()
      .every((entry) => /^(u|t|st|tpl|r|auth)-/.test(entry.id))
  );
  t(
    'failing programs registry degrades to EMPTY with sources version "unavailable"',
    !liveSnap.entities.some((entity) => entity.registry === 'programs') &&
      liveSnap.sources.some(
        (source) => source.source === 'products/programs' && source.version === 'unavailable'
      )
  );
  t(
    'API-stamped version is carried through; others get content-derived versions',
    liveSnap.sources.some((s) => s.source === 'workflows/templates' && s.version === '2026-07-15') &&
      liveSnap.sources.some((s) => s.source === 'iam/users' && /^c-[0-9a-f]{8}$/.test(s.version))
  );
  t(
    'assignees come from users+teams labels (deduped), untrusted pass-through',
    liveSnap.assignees.includes('Wael') &&
      liveSnap.assignees.includes('Underwriting Team') &&
      liveSnap.assignees.filter((name) => name === 'Jordan Reyes').length === 1 &&
      !liveSnap.assignees.includes('Layla')
  );
  t(
    'live registries project into the scope-allocated ParseOptions keys',
    (liveSnap.instanceRegistry['assign_user'] ?? []).some((entry) => entry.id === 'u-wael') &&
      (liveSnap.instanceRegistry['retailer'] ?? []).some((entry) => entry.id === 'r-growmark') &&
      (liveSnap.instanceOptions['stage'] ?? []).includes('Processing') &&
      (liveSnap.instanceOptions['template'] ?? []).includes('Origination')
  );
  t('relatedWorkflows honestly empty (the /rules resource is unconfirmed)', liveSnap.relatedWorkflows.length === 0);

  /* ---- 3. Parity: same text, both adapters, equal semantic cores ---------- */
  const standalone = new StandaloneBrainContextProvider();
  const standaloneSnap = await standalone.getSnapshot({ profile: 'standalone-demo', purpose: 'parse' });
  const parseBoth = (text: string) => ({
    demo: parseInstruction(text, snapshotToParseOptions(standaloneSnap)),
    live: parseInstruction(text, snapshotToParseOptions(liveSnap)),
  });

  const fx1 = parseBoth('when a loan is approved, assign to Wael');
  t('fixture 1: semantic cores equal (assign to Wael)', semanticCore(fx1.demo) === semanticCore(fx1.live),
    `${semanticCore(fx1.demo)} vs ${semanticCore(fx1.live)}`);
  t('fixture 1: clean parse under BOTH adapters',
    fx1.demo.unresolved.length === 0 && fx1.live.unresolved.length === 0 &&
      fx1.demo.uncovered.length === 0 && fx1.live.uncovered.length === 0);

  const fx2 = parseBoth('when a loan is approved and risk grade is worse than B, assign to Sara');
  t('fixture 2: semantic cores equal (condition via per-key static fallback)',
    semanticCore(fx2.demo) === semanticCore(fx2.live), `${semanticCore(fx2.demo)} vs ${semanticCore(fx2.live)}`);
  const liveAssignee = fx2.live.rule?.actions[0]?.params['assignee'];
  const demoAssignee = fx2.demo.rule?.actions[0]?.params['assignee'];
  t(
    'fixture 2: live resolves through the instance registry (ScopeRef with a platform id)',
    typeof liveAssignee === 'object' && liveAssignee !== null && isScopeRef(liveAssignee) &&
      liveAssignee.level === 'instance' && liveAssignee.id === 'u-sara' && liveAssignee.label === 'Sara',
    JSON.stringify(liveAssignee)
  );
  t(
    'fixture 2: standalone stays a bare label (its registry carries no platform ids)',
    demoAssignee === 'Sara',
    JSON.stringify(demoAssignee)
  );

  const fx3 = parseBoth('when a loan is approved, assign to Zorblatt Nine');
  t('fixture 3: unknown entity unresolved under BOTH (reject, never coerce)',
    fx3.demo.unresolved.length === 1 && fx3.live.unresolved.length === 1 &&
      fx3.demo.unresolved[0].param === 'assignee' && fx3.live.unresolved[0].param === 'assignee');
  t('fixture 3: semantic cores equal (empty action params both sides)',
    semanticCore(fx3.demo) === semanticCore(fx3.live));
  t(
    'fixture 3: neither adapter fabricates a params value for the unknown entity',
    Object.keys(fx3.demo.rule?.actions[0]?.params ?? { x: 1 }).length === 0 &&
      Object.keys(fx3.live.rule?.actions[0]?.params ?? { x: 1 }).length === 0
  );

  // Demo-only label: "Layla" ships in the static ASSIGNEES but was NOT seeded
  // into the mock live registries — it must ground ONLY under standalone.
  const fxDemoOnly = parseBoth('when a loan is approved, assign to Layla');
  t('demo-only label grounds under standalone', fxDemoOnly.demo.unresolved.length === 0 &&
      labelOf(fxDemoOnly.demo.rule?.actions[0]?.params['assignee']) === 'Layla');
  t(
    'demo-only label does NOT ground under the live snapshot (unresolved, no demo bleed)',
    fxDemoOnly.live.unresolved.length === 1 &&
      fxDemoOnly.live.unresolved[0].heard.toLowerCase() === 'layla' &&
      Object.keys(fxDemoOnly.live.rule?.actions[0]?.params ?? { x: 1 }).length === 0
  );

  /* ---- 4. Fail-closed: failing users registry ----------------------------- */
  const usersDown = new MockLiveTransport(
    { ...liveFixtures(), [endpointKey('teams')]: { data: [] } }, // teams reachable but empty
    new Set([endpointKey('users'), endpointKey('programs')])
  );
  const degraded = makeLiveProvider('sweetbank', usersDown);
  const degradedSnap = await degraded.getSnapshot({ profile: 'landjourney-live', purpose: 'parse' });
  t('failing users registry → assignees EMPTY (no demo fallback into the snapshot)',
    degradedSnap.assignees.length === 0 && !degradedSnap.entities.some((e) => e.registry === 'users'));
  t('failing users registry → sources records "unavailable" for iam/users',
    degradedSnap.sources.some((s) => s.source === 'iam/users' && s.version === 'unavailable'));
  t('degradation never throws the snapshot away (other registries intact, id valid)',
    /^ctx-[0-9a-f]{8}$/.test(degradedSnap.snapshotId) &&
      degradedSnap.entities.some((e) => e.registry === 'retailers'));
  const degradedParse = parseInstruction(
    'when a loan is approved, assign to Marisol Vega',
    snapshotToParseOptions(degradedSnap)
  );
  t(
    'parse naming a live-registry assignee yields an unresolved slot, never a resolution',
    degradedParse.unresolved.length === 1 &&
      degradedParse.unresolved[0].heard.toLowerCase() === 'marisol vega' &&
      Object.keys(degradedParse.rule?.actions[0]?.params ?? { x: 1 }).length === 0,
    JSON.stringify(degradedParse.unresolved)
  );

  /* ---- 5. Fail-closed: capability off ------------------------------------- */
  const gatedTransport = new MockLiveTransport(liveFixtures());
  const gated = makeLiveProvider('sweetbank', gatedTransport, CAPS_OFF);
  const gatedSnap = await gated.getSnapshot({ profile: 'landjourney-live', purpose: 'parse' });
  t('live-vocabulary capability off → transport is NEVER called', gatedTransport.calls.length === 0);
  t(
    'capability off → every registry empty, every source "unavailable", snapshot still valid',
    gatedSnap.entities.length === 0 && gatedSnap.assignees.length === 0 &&
      Object.keys(gatedSnap.instanceRegistry).length === 0 &&
      gatedSnap.sources.length === REGISTRY_ENDPOINTS.length &&
      gatedSnap.sources.every((s) => s.version === 'unavailable') &&
      /^ctx-[0-9a-f]{8}$/.test(gatedSnap.snapshotId) && gatedSnap.vocabularyHash.length > 0
  );

  /* ---- 6. Tenant identity keying ------------------------------------------ */
  const tenantA = await makeLiveProvider('tenant-a').getSnapshot({ profile: 'landjourney-live', purpose: 'parse' });
  const tenantB = await makeLiveProvider('tenant-b').getSnapshot({ profile: 'landjourney-live', purpose: 'parse' });
  t('distinct tenantKeys, identical data → DIFFERENT snapshotIds (identity in the id)',
    tenantA.snapshotId !== tenantB.snapshotId);
  t('distinct tenantKeys, identical data → EQUAL vocabularyHash (content in the hash)',
    tenantA.vocabularyHash === tenantB.vocabularyHash);
  const tenantA2 = await makeLiveProvider('tenant-a').getSnapshot({ profile: 'landjourney-live', purpose: 'parse' });
  t('same tenantKey, same data → same snapshotId (new instance, reproducible id)',
    tenantA.snapshotId === tenantA2.snapshotId);

  /* ---- 7. Abort is a cancellation, not a degradation ---------------------- */
  const abortController = new AbortController();
  abortController.abort();
  let aborted = false;
  try {
    await makeLiveProvider('sweetbank').getSnapshot(
      { profile: 'landjourney-live', purpose: 'parse' },
      abortController.signal
    );
  } catch {
    aborted = true;
  }
  t('aborted signal → getSnapshot rejects (signal reaches every transport fetch)', aborted);

  return failures;
}

// Run only when executed directly; importing (context-switch suite) runs nothing.
const executedDirectly =
  typeof process !== 'undefined' &&
  typeof process.argv[1] === 'string' &&
  /assert-brain-transplant-parity\.(ts|js|mts|mjs|cts|cjs)$/.test(process.argv[1]);

if (executedDirectly) {
  main().then(
    (count) => {
      if (count > 0) {
        console.error(`\n✗ assert-brain-transplant-parity: ${count} failure(s).`);
        process.exit(1);
      }
      console.log('\n✓ transplant parity holds: same contract, same semantic cores, fail-closed live edges.');
    },
    (error) => {
      console.error('✗ assert-brain-transplant-parity crashed:', error);
      process.exit(1);
    }
  );
}
