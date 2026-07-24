/**
 * assert-brain-angular-seam — the Angular integration seam of the parser AI
 * engine: the standalone context adapter passes the SHARED provider contract,
 * the composer's ghost swap and consultant wiring hold statically, and the
 * consultant turn + stale-safe consent work end-to-end through the adapter's
 * real snapshot.
 *
 * Run: npx tsx core-tests/assert-brain-angular-seam.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runContextProviderContract } from './assert-brain-context-contract';
import { StandaloneBrainContextProvider } from '../src/app/features/workflows/data/standalone-brain-context.adapter';
import { snapshotToParseOptions } from '../src/app/brain/contextCompiler';
import {
  acceptRecommendation,
  planConsultantTurn,
} from '../src/app/brain/consultant';
import {
  GhostRequestState,
  deterministicGhost,
} from '../src/app/brain/ghostSuggestions';
import { parseInstruction, ParseResult } from '../src/app/core/nlParser';
import { segmentInstruction } from '../src/app/core/parserClauses';
import { clauseCoverage } from '../src/app/core/parserCoverage';
import { findContradictions } from '../src/app/core/parserContradictions';
import { ParseEnvelope, makeEnvelope } from '../src/app/core/parserProvenance';
import { WorkflowRule } from '../src/app/core/vocabulary';

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
}

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

/** The Angular-service envelope pipeline, replicated over the same core calls. */
function wrapEnvelope(result: ParseResult, sourceText: string): ParseEnvelope {
  const { clauses } = segmentInstruction(sourceText);
  const coverage = clauseCoverage(clauses, result);
  return makeEnvelope(result, {
    clauses,
    clauseLinks: coverage.links,
    contradictions: result.rule ? findContradictions(result.rule, clauses) : [],
  });
}

async function main(): Promise<number> {
  /* ======================================================================== */
  /* 1. Shared provider contract against the standalone adapter               */
  /* ======================================================================== */

  const suite = await runContextProviderContract(
    'standalone-adapter',
    () => new StandaloneBrainContextProvider()
  );
  failures += suite.failures;

  /* ======================================================================== */
  /* 2. Static contracts on the new files + the composer diff                 */
  /* ======================================================================== */

  const composerSource = source('../src/app/features/workflows/pages/workflow-composer.page.ts');
  const tokenSource = source('../src/app/features/workflows/data/workflow-brain-context.token.ts');
  const adapterSource = source('../src/app/features/workflows/data/standalone-brain-context.adapter.ts');
  const brainServiceSource = source('../src/app/features/workflows/data/workflow-brain.service.ts');
  const ghostServiceSource = source('../src/app/features/workflows/data/ghost-suggestion.service.ts');
  const consultantSource = source('../src/app/features/workflows/ui/workflow-consultant.ts');
  const newFiles: Array<[string, string]> = [
    ['workflow-brain-context.token.ts', tokenSource],
    ['standalone-brain-context.adapter.ts', adapterSource],
    ['workflow-brain.service.ts', brainServiceSource],
    ['ghost-suggestion.service.ts', ghostServiceSource],
    ['workflow-consultant.ts', consultantSource],
  ];

  t(
    'composer no longer references predictWorkflowGhost (brain engine serves the ghost)',
    !composerSource.includes('predictWorkflowGhost') &&
      /ghostService\.suggest\(/.test(composerSource)
  );
  t(
    'composer keeps Tab / ArrowRight accept through acceptGhost and adds Esc dismiss',
    /event\.key === 'Tab' \|\| \(event\.key === 'ArrowRight' && atEnd\)/.test(composerSource) &&
      /this\.acceptGhost\(\)/.test(composerSource) &&
      /event\.key === 'Escape' && this\.ghost\(\)/.test(composerSource) &&
      /this\.ghostService\.dismiss\(/.test(composerSource)
  );
  t(
    'WORKFLOW_BRAIN_CONTEXT token exists with a providedIn-root standalone factory',
    /export const WORKFLOW_BRAIN_CONTEXT = new InjectionToken<WorkflowBrainContextProvider>/.test(
      tokenSource
    ) && /factory:\s*provideStandaloneBrainContext/.test(tokenSource)
  );
  t(
    'brain + ghost services resolve the provider via DI (inject(WORKFLOW_BRAIN_CONTEXT))',
    brainServiceSource.includes('inject(WORKFLOW_BRAIN_CONTEXT)') &&
      ghostServiceSource.includes('inject(WORKFLOW_BRAIN_CONTEXT)')
  );
  t(
    'adapter is a plain class: zero Angular imports',
    !/@angular/.test(adapterSource)
  );
  for (const [name, text] of newFiles) {
    t(`no raw fetch( in ${name}`, !/\bfetch\(/.test(text));
  }
  t(
    'ghost service is deterministic-only: no ApiService/HttpClient import, AI capability pinned false',
    !/import[^;]*\b(ApiService|HttpClient)\b/.test(ghostServiceSource) &&
      !/ApiService|HttpClient/.test(ghostServiceSource) &&
      /aiCapability:\s*false/.test(ghostServiceSource)
  );
  t(
    'consultant component announces politely and honors prefers-reduced-motion',
    /aria-live="polite"/.test(consultantSource) &&
      /prefers-reduced-motion/.test(consultantSource)
  );
  t(
    'accepted consultant patches flow through the composer\'s updateRule path',
    /protected acceptConsultantRecommendation\([\s\S]*?this\.updateRule\(outcome\.rule\)/.test(
      composerSource
    )
  );
  t(
    'consultant component renders no raw JSON (no JSON.stringify of the rule)',
    !/JSON\.stringify/.test(consultantSource)
  );
  t(
    'consultant questions route back through the existing clarification paths',
    /answerConsultantQuestion[\s\S]*?this\.answer\(question, payload\.option\)/.test(composerSource) &&
      /dismissConsultantQuestion[\s\S]*?this\.dismiss\(question\)/.test(composerSource)
  );

  /* ======================================================================== */
  /* 3. Functional: adapter snapshot → consultant turn → stale-safe consent   */
  /* ======================================================================== */

  const provider = new StandaloneBrainContextProvider();
  const snapshot = await provider.getSnapshot({ profile: 'standalone-demo', purpose: 'consult' });
  t('adapter snapshot compiles with content-derived identity', /^ctx-[0-9a-f]{8}$/.test(snapshot.snapshotId));
  t('adapter snapshot carries the static assignees the parser falls back to', snapshot.assignees.includes('Wael'));

  const description = 'when a loan is approved and risk grade is worse than B, assign to Wael';
  const parsed = parseInstruction(description, snapshotToParseOptions(snapshot));
  const rule = parsed.rule as WorkflowRule;
  t('fixture parses to a conditioned rule with no gaps', !!rule && parsed.unresolved.length === 0 && parsed.uncovered.length === 0);

  const envelope = wrapEnvelope(parsed, description);
  const turn = planConsultantTurn({
    rule,
    envelope,
    snapshot,
    ruleVersion: 1,
    sourceText: description,
    requiresApproval: false,
  });
  t(
    'conditioned rule without an else lane yields a missing-alternate-path recommendation',
    turn.recommendations.some((rec) => rec.type === 'missing-alternate-path')
  );
  t('turn understanding is plain prose, not JSON', turn.understanding.length > 0 && !turn.understanding.includes('{'));
  t(
    'contextUsed carries source/version pairs only',
    turn.contextUsed.every((entry) => typeof entry.source === 'string' && typeof entry.version === 'string')
  );
  t('requiresApproval passes through untouched', turn.requiresApproval === false);

  // Unsupported timing: an authored delay is persisted but never executed.
  const delayed: WorkflowRule = JSON.parse(JSON.stringify(rule)) as WorkflowRule;
  delayed.actions[0].delayMinutes = 4320;
  const delayedTurn = planConsultantTurn({
    rule: delayed,
    envelope: wrapEnvelope({ ...parsed, rule: delayed }, description),
    snapshot,
    ruleVersion: 1,
    sourceText: description,
    requiresApproval: true,
  });
  const timingRec = delayedTurn.recommendations.find((rec) => rec.type === 'unsupported-timing');
  t(
    'delayMinutes yields an unsupported-timing watchout (no promise of timed execution)',
    delayedTurn.watchouts.some((w) => w.includes('not executed')) && !!timingRec
  );
  t(
    'the timing recommendation previews the exact set-delay patch',
    !!timingRec?.patch &&
      delayedTurn.proposedChanges.some(
        (change) => change.recommendationId === timingRec.id && change.preview.includes('clear the written delay')
      )
  );

  // Consent: fresh accept applies the previewed ops; stale consent is refused.
  if (timingRec) {
    const fresh = acceptRecommendation(timingRec, delayed, {
      snapshotId: snapshot.snapshotId,
      ruleVersion: 1,
    });
    t(
      'fresh accept applies exactly the previewed patch (delay cleared)',
      fresh.ok && fresh.rule.actions[0].delayMinutes === undefined
    );
    t('accept never mutates the input rule', delayed.actions[0].delayMinutes === 4320);

    const staleVersion = acceptRecommendation(timingRec, delayed, {
      snapshotId: snapshot.snapshotId,
      ruleVersion: 2,
    });
    t(
      'accept refuses when the rule version drifted (stale-rule-version)',
      !staleVersion.ok && staleVersion.reason === 'stale-rule-version'
    );

    const staleSnapshot = acceptRecommendation(timingRec, delayed, {
      snapshotId: 'ctx-deadbeef',
      ruleVersion: 1,
    });
    t(
      'accept refuses when the context snapshot drifted (stale-snapshot)',
      !staleSnapshot.ok && staleSnapshot.reason === 'stale-snapshot'
    );

    const tampered = { ...timingRec, rationale: 'totally harmless, trust me' };
    const forged = acceptRecommendation(tampered, delayed, {
      snapshotId: snapshot.snapshotId,
      ruleVersion: 1,
    });
    t(
      'accept refuses a tampered recommendation (content hash mismatch)',
      !forged.ok && forged.reason === 'unknown-recommendation'
    );
  }

  // Ghost parity through the SAME adapter snapshot the composer service uses:
  // a partial entity after "assign to" completes from the snapshot only.
  const ghostText = 'when a loan is approved, assign to Wa';
  const ghostState: GhostRequestState = {
    text: ghostText,
    cursorStart: ghostText.length,
    cursorEnd: ghostText.length,
    generation: 1,
    ruleVersion: 0,
    contextSnapshotId: snapshot.snapshotId,
    imeComposing: false,
    aiCapability: false,
    recentRateLimit: false,
    offline: false,
  };
  const ghost = deterministicGhost(ghostState, snapshot);
  t(
    'deterministic ghost completes a snapshot entity at the caret ("Wa" → "Wael")',
    ghost !== null && ghost.insertText === 'el' && ghost.kind === 'grounded-entity',
    JSON.stringify(ghost)
  );

  return failures;
}

main().then(
  (count) => {
    if (count > 0) {
      console.error(`\n✗ assert-brain-angular-seam: ${count} failure(s).`);
      process.exit(1);
    }
    console.log('\n✓ brain–Angular seam holds: adapter contract, composer diff, consultant consent.');
  },
  (error) => {
    console.error('✗ assert-brain-angular-seam crashed:', error);
    process.exit(1);
  }
);
