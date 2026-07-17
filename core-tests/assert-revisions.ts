import { applyRevision } from '../packages/rule-core/src/revisions';
import { parseInstruction } from '../packages/rule-core/src/nlParser';
import { explainSimulation } from '../packages/rule-core/src/simulationExplainer';
import { REQUESTS } from '../packages/rule-core/src/platformData';
import { WorkflowRule, defaultControls } from '../packages/rule-core/src/vocabulary';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.error(`FAIL ${label}`, detail ?? '');
  }
}

const parsed = parseInstruction('When a loan is approved, notify Wael');
if (!parsed.rule) throw new Error('Revision fixture did not parse.');

const unknownRecipient = applyRevision(parsed.rule, 'Notify Santa Claus instead of Wael');
check('revision rejects an unknown replacement recipient', unknownRecipient.status === 'unrecognized');
check(
  'rejected replacement leaves the original rule untouched',
  parsed.rule.actions[0]?.params.value === 'Wael'
);

const knownRecipient = applyRevision(parsed.rule, 'Notify Sara instead of Wael');
check(
  'revision accepts a vocabulary-confirmed replacement recipient',
  knownRecipient.status === 'applied' && knownRecipient.rule.actions[0]?.params.value === 'Sara'
);

const removeOnlyAction = applyRevision(parsed.rule, 'Remove the notify step');
check('revision cannot remove the only primary outcome', removeOnlyAction.status === 'unrecognized');
check('blocked removal leaves one primary action', parsed.rule.actions.length === 1);

const otherwiseRule: WorkflowRule = {
  schemaVersion: 3,
  triggers: [{ event: 'LOAN APPROVED' }],
  conditions: {
    logic: 'AND',
    children: [{ field: 'loan_amount', operator: 'gte', value: '999999999' }],
  },
  actions: [{ action: 'notify', params: { value: 'Wael' } }],
  else: [{ action: 'add_tag', params: { value: 'manual-review' } }],
  controls: defaultControls(),
};
const approvedRequest = REQUESTS.find((request) => request.id === 'REQ-4821');
if (!approvedRequest) throw new Error('Simulation fixture request is missing.');
const alternateSimulation = explainSimulation(otherwiseRule, [approvedRequest]);
const alternateResult = alternateSimulation.results[0];
check('Otherwise dispatch is classified as a run', alternateResult?.outcome === 'run', alternateResult);
check(
  'Otherwise dispatch explains its alternate action',
  alternateResult?.actions.some((action) => action.includes('manual-review')) === true,
  alternateResult
);
check(
  'Otherwise dispatch contributes to would-run totals',
  alternateSimulation.wouldRun === 1 && alternateSimulation.wouldSkip === 0,
  alternateSimulation
);

if (failures) {
  console.error(`\n${failures} revision/simulation assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll revision and alternate-path simulation assertions passed.');
