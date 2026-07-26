/**
 * assert-brain-context-switch — reducer-level end-to-end of the transplant
 * moment: a session running on the standalone snapshot is context-switched to
 * the Landjourney-live(mock) snapshot for the SAME tenant (facts survive,
 * everything snapshot-derived dies), then to a DIFFERENT tenant (tenant memory
 * dies too). Stale consent after the switch is ignored with a history entry,
 * ghost suggestions go stale by construction, cache keys cannot collide across
 * tenants, and the authoring history stays append-only throughout.
 *
 * Run: npx tsx core-tests/assert-brain-context-switch.ts
 */
import {
  BrainSessionState,
  initialBrainState,
  reduceBrain,
} from '../packages/workflow-brain/src/brainState';
import { snapshotToParseOptions } from '../packages/workflow-brain/src/contextCompiler';
import {
  GhostRequestState,
  deterministicGhost,
  ghostIsFresh,
} from '../packages/workflow-brain/src/ghostSuggestions';
import { buildCacheKey, hashText } from '../packages/workflow-brain/src/observability';
import { makeEnvelope } from '../packages/rule-core/src/parserProvenance';
import { parseInstruction } from '../packages/rule-core/src/nlParser';
import { StandaloneBrainContextProvider } from '../src/app/features/workflows/data/standalone-brain-context.adapter';
import { CAPS_ON, makeBaseTransport, makeLiveProvider } from './assert-brain-transplant-parity';

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<number> {
  /* ---- providers: standalone, live SAME tenant, live OTHER tenant --------- */
  // The transplant scenario at parity: the live adapter serving the SAME
  // opaque tenantKey the standalone session ran under, then a real second
  // tenant. tenantKey is opaque to the Brain — only equality matters.
  const standalone = new StandaloneBrainContextProvider();
  const snapDemo = await standalone.getSnapshot({ profile: 'standalone-demo', purpose: 'parse' });
  const tenantKey = snapDemo.identity.tenantKey;
  const snapLiveSame = await makeLiveProvider(tenantKey, makeBaseTransport(), CAPS_ON).getSnapshot({
    profile: 'landjourney-live',
    purpose: 'parse',
  });
  const snapLiveOther = await makeLiveProvider('other-bank', makeBaseTransport(), CAPS_ON).getSnapshot({
    profile: 'landjourney-live',
    purpose: 'parse',
  });
  t('fixtures: three distinct snapshots, live pair differing only in tenant',
    new Set([snapDemo.snapshotId, snapLiveSame.snapshotId, snapLiveOther.snapshotId]).size === 3 &&
      snapLiveSame.vocabularyHash === snapLiveOther.vocabularyHash);

  /* ---- build up a working session on the standalone snapshot -------------- */
  const trail: BrainSessionState[] = [];
  let at = 1000;
  let state = initialBrainState('standalone-demo', tenantKey);
  const dispatch = (event: Parameters<typeof reduceBrain>[1]) => {
    state = reduceBrain(state, event);
    trail.push(state);
  };

  dispatch({ type: 'context-attached', snapshot: snapDemo, at: at++ });
  t('attach adopts the standalone snapshot', state.snapshotId === snapDemo.snapshotId &&
      state.vocabularyHash === snapDemo.vocabularyHash);

  dispatch({ type: 'fact-recorded', fact: 'Loans above 250k need dual review', at: at++ });
  dispatch({ type: 'fact-recorded', fact: 'Escalations go to the operations desk', at: at++ });
  t('facts recorded before the switch', state.acceptedFacts.length === 2);

  const description = 'when a loan is approved, assign to Wael';
  dispatch({ type: 'description-changed', description, at: at++ });
  const parsed = parseInstruction(description, snapshotToParseOptions(snapDemo));
  dispatch({
    type: 'parse-completed',
    envelope: makeEnvelope(parsed, {}),
    generation: state.generation,
    at: at++,
  });
  t('parse landed: envelope set, clean parse advances to recommend',
    state.envelope !== null && state.phase === 'recommend' && state.ruleVersion === 1);

  dispatch({
    type: 'recommendations-issued',
    refs: [
      { id: 'rec-1', status: 'open', snapshotId: state.snapshotId!, ruleVersion: state.ruleVersion },
      { id: 'rec-2', status: 'open', snapshotId: state.snapshotId!, ruleVersion: state.ruleVersion },
    ],
    at: at++,
  });
  t('recommendations open before the switch',
    state.recommendations.filter((ref) => ref.status === 'open').length === 2);

  // An open clarification, as the orchestrator (owned elsewhere) would surface
  // it. Injected directly — openQuestionIds has no producer event in the
  // reducer; history is untouched, so the append-only sweep below still holds.
  state = { ...state, openQuestionIds: ['q-open'] };

  // A live ghost suggestion minted against the pre-switch snapshot.
  const ghostText = 'when a loan is approved, assign to Wa';
  const ghostState: GhostRequestState = {
    text: ghostText,
    cursorStart: ghostText.length,
    cursorEnd: ghostText.length,
    generation: state.generation,
    ruleVersion: state.ruleVersion,
    contextSnapshotId: snapDemo.snapshotId,
    imeComposing: false,
    aiCapability: false,
    recentRateLimit: false,
    offline: false,
  };
  const ghost = deterministicGhost(ghostState, snapDemo);
  t('pre-switch ghost exists and is fresh against its own snapshot',
    ghost !== null && ghostIsFresh(ghost!, ghostState));

  /* ---- context-switched: live snapshot, SAME tenant ----------------------- */
  dispatch({ type: 'context-switched', snapshot: snapLiveSame, at: at++ });
  t('same-tenant switch adopts the live snapshotId/vocabularyHash/profile',
    state.snapshotId === snapLiveSame.snapshotId &&
      state.vocabularyHash === snapLiveSame.vocabularyHash &&
      state.profile === 'landjourney-live' && state.tenantKey === tenantKey);
  t('same-tenant switch keeps accepted facts (context-independent memory)',
    state.acceptedFacts.length === 2);
  t('same-tenant switch expires every open recommendation',
    state.recommendations.length === 2 &&
      state.recommendations.every((ref) => ref.status === 'expired'));
  t('same-tenant switch discards the parse envelope and open questions',
    state.envelope === null && state.openQuestionIds.length === 0);

  // Stale consent: the pre-switch recommendation is accepted AFTER the switch.
  const beforeStaleAccept = state;
  dispatch({ type: 'recommendation-accepted', id: 'rec-1', at: at++ });
  t('stale recommendation-accepted after the switch is ignored (no status flip)',
    state.recommendations.find((ref) => ref.id === 'rec-1')?.status === 'expired' &&
      state.acceptedFacts === beforeStaleAccept.acceptedFacts &&
      state.envelope === null);
  t('the ignored stale accept still leaves a history entry',
    state.history[state.history.length - 1].kind === 'recommendation-accepted' &&
      state.history[state.history.length - 1].detail === 'stale-accept-ignored');

  // Ghost freshness across the switch: same text/caret, new snapshot.
  t('ghostIsFresh is false across the switch (snapshotId mismatch alone kills it)',
    ghost !== null && !ghostIsFresh(ghost!, { ...ghostState, contextSnapshotId: state.snapshotId! }));

  /* ---- context-switched: DIFFERENT tenant --------------------------------- */
  dispatch({ type: 'fact-recorded', fact: 'Tenant-A prefers same-day escalation', at: at++ });
  dispatch({ type: 'context-switched', snapshot: snapLiveOther, at: at++ });
  t('tenant switch adopts the new tenantKey and snapshot',
    state.tenantKey === 'other-bank' && state.snapshotId === snapLiveOther.snapshotId);
  t('tenant switch discards ALL accepted facts (tenant memory must not travel)',
    state.acceptedFacts.length === 0);
  t('tenant switch discards ALL recommendation history (not just open ones)',
    state.recommendations.length === 0);
  t('tenant switch recorded as such in history',
    state.history[state.history.length - 1].detail ===
      `tenant switched to snapshot ${snapLiveOther.snapshotId}`);

  /* ---- cache keys cannot collide across tenants --------------------------- */
  const keyParts = {
    parserVersion: '2026.07.24-1',
    promptVersion: 'p1',
    inputHash: hashText(description),
    optionsHash: hashText(JSON.stringify(snapshotToParseOptions(snapLiveSame))),
  };
  const keyTenantA = buildCacheKey({
    ...keyParts,
    tenantKey,
    vocabularyHash: snapLiveSame.vocabularyHash,
  });
  const keyTenantB = buildCacheKey({
    ...keyParts,
    tenantKey: 'other-bank',
    vocabularyHash: snapLiveOther.vocabularyHash,
  });
  t('cache key from tenant-A parts ≠ tenant-B (even with IDENTICAL vocabulary hashes)',
    snapLiveSame.vocabularyHash === snapLiveOther.vocabularyHash && keyTenantA !== keyTenantB);
  t('the tenantKey is literally present in the key (partition by construction)',
    keyTenantA.startsWith(`${tenantKey}|`) && keyTenantB.startsWith('other-bank|'));

  /* ---- history append-only across the whole session ----------------------- */
  let appendOnly = true;
  for (let i = 1; i < trail.length; i++) {
    const prev = trail[i - 1].history;
    const next = trail[i].history;
    if (next.length !== prev.length + 1) appendOnly = false;
    for (let j = 0; j < prev.length; j++) {
      if (next[j] !== prev[j]) appendOnly = false; // same objects — never rewritten
    }
  }
  t('history is append-only throughout (every event: +1 entry, prefix untouched)', appendOnly);
  t('history spans the whole session in event order',
    state.history.length === trail.length &&
      state.history.every((entry, i) => i === 0 || entry.at >= state.history[i - 1].at));

  return failures;
}

main().then(
  (count) => {
    if (count > 0) {
      console.error(`\n✗ assert-brain-context-switch: ${count} failure(s).`);
      process.exit(1);
    }
    console.log('\n✓ context switch holds: facts scoped to tenants, derived state scoped to snapshots.');
  },
  (error) => {
    console.error('✗ assert-brain-context-switch crashed:', error);
    process.exit(1);
  }
);
