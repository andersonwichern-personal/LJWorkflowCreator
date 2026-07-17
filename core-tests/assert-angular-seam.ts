/**
 * Angular data-seam suite: the four-eyes gate truth table (shared core)
 * and the mock backend's proposal interception — the behavior the builder and
 * proposals page sit on. Run: npx tsx core-tests/assert-angular-seam.ts
 */
// Node-side run of Angular-decorated classes: load the JIT compiler so the
// partially-compiled library declarations (HttpClient via ApiService) resolve.
import '@angular/compiler';
import { firstValueFrom } from 'rxjs';
import { shouldProposeWorkflowWrite } from '../src/app/core/fourEyes';
import { emptyRule } from '../src/app/core/vocabulary';
import {
  WorkflowsMockService,
  type SaveOutcome,
} from '../src/app/features/workflows/data/workflows.service';

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
}

/* ---- gate truth table (shared core, exercised from the Angular side) ------ */

const shadow = emptyRule(); // defaults: mode shadow
const armed = { ...emptyRule(), controls: { ...emptyRule().controls, mode: 'armed' as const } };

t(
  'cosmetic write (no rule, no enabled) never proposes',
  shouldProposeWorkflowWrite({ currentRule: armed, currentEnabled: true }) === false
);
t(
  'editing an ENABLED shadow rule proposes (enabled OR armed is protected)',
  shouldProposeWorkflowWrite({ currentRule: shadow, currentEnabled: true, nextRule: shadow }) === true
);
t(
  'editing a DISABLED armed rule proposes',
  shouldProposeWorkflowWrite({ currentRule: armed, currentEnabled: false, nextRule: armed }) === true
);
t(
  'editing a disabled shadow draft lands directly',
  shouldProposeWorkflowWrite({ currentRule: shadow, currentEnabled: false, nextRule: shadow }) === false
);
t(
  'ACTIVATING a disabled shadow draft proposes (activation is protected)',
  shouldProposeWorkflowWrite({ currentRule: shadow, currentEnabled: false, nextEnabled: true }) === true
);
t(
  'ARMING a disabled shadow draft proposes (arming is activation)',
  shouldProposeWorkflowWrite({ currentRule: shadow, currentEnabled: false, nextRule: armed }) === true
);

/* ---- mock backend proposal flow ------------------------------------------- */

async function main() {
  const service = new WorkflowsMockService();
  const rows = await firstValueFrom(service.list());
  t('mock seeds workflows', rows.length >= 3, String(rows.length));

  const target = rows[0]; // seeded enabled:true → protected
  const edited = structuredClone(target.ruleJson);
  edited.actions.push({ action: 'add_tag', params: { value: 'four-eyes-test' } });

  const outcome: SaveOutcome = await firstValueFrom(
    service.update(target.id, { name: target.name, ruleJson: edited, expectedVersion: target.version })
  );
  t('update on an enabled workflow becomes a proposal', outcome.kind === 'proposed');
  t(
    'the record still carries the ORIGINAL rule (write did not land)',
    JSON.stringify(outcome.record.ruleJson) === JSON.stringify(target.ruleJson)
  );
  t('record is marked pending', outcome.record.proposalStatus === 'pending');

  const proposals = await firstValueFrom(service.listProposals());
  t('proposal is listed pending', proposals.some((p) => p.status === 'pending' && p.workflowId === target.id));

  const pending = proposals.find((p) => p.status === 'pending' && p.workflowId === target.id)!;
  const applied = await firstValueFrom(service.approveProposal(pending.id));
  t('approve applies the proposed rule', JSON.stringify(applied.ruleJson) === JSON.stringify(edited));
  t('approve bumps the version', applied.version === target.version + 1);

  const after = await firstValueFrom(service.get(target.id));
  t('after approval the pending marker clears', after.proposalStatus === undefined);

  // Reject path on a fresh proposal.
  const outcome2 = await firstValueFrom(
    service.update(target.id, { name: target.name, ruleJson: target.ruleJson, expectedVersion: applied.version })
  );
  t('second protected edit proposes again', outcome2.kind === 'proposed');
  if (outcome2.kind === 'proposed') {
    await firstValueFrom(service.rejectProposal(outcome2.proposalId));
    const afterReject = await firstValueFrom(service.get(target.id));
    t(
      'reject leaves the applied rule in place',
      JSON.stringify(afterReject.ruleJson) === JSON.stringify(edited)
    );
  }

  // Version guard still enforced ahead of the gate.
  let conflict = false;
  try {
    await firstValueFrom(
      service.update(target.id, { name: 'x', ruleJson: edited, expectedVersion: 999 })
    );
  } catch {
    conflict = true;
  }
  t('stale expectedVersion still conflicts', conflict);

  // Disabled shadow draft writes land directly (no proposal).
  const created = await firstValueFrom(
    service.create({ name: 'Draft', ruleJson: emptyRule(), enabled: false })
  );
  const direct = await firstValueFrom(
    service.update(created.id, { name: 'Draft', ruleJson: emptyRule(), expectedVersion: created.version })
  );
  t('disabled shadow draft saves directly', direct.kind === 'saved');

  if (failures) {
    console.error(`\n${failures} angular-seam assertion(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll angular-seam assertions passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
