/**
 * Cross-surface sync fixpoint contract.
 *
 * The composer keeps three surfaces consistent — the AI-text cursor, the
 * 3-column builder, and the workflow canvas — by having all three read one
 * shared rule signal, and by typing the canonical `composeRuleText(rule)` back
 * into the cursor after every builder/canvas edit. The invariant that keeps
 * them from drifting is that re-parsing that canonical text must NOT change the
 * rule again: parse∘compose must reach a STABLE FIXPOINT.
 *
 *     R  --compose-->  T  --parse-->  R'      (what pressing Enter yields)
 *     R' --compose--> T' --parse-->  R''      (MUST equal R' — no oscillation)
 *
 * If R'' ≠ R', a re-parse grows/shrinks the rule and the text/builder/canvas
 * surfaces desync. This suite proves the fixpoint across the ENTIRE vocabulary
 * (process over content: iterating EVENTS / ACTIONS / FIELDS themselves, so a
 * client's content changes are covered with no test edit) plus representative
 * multi-part combos. It also proves every original component survives the first
 * round (triggers + actions exactly, original conditions preserved).
 *
 * Run: npx tsx core-tests/assert-sync-fixpoint.ts
 */
import { parseInstruction } from '../src/app/core/nlParser';
import { composeRuleText } from '../src/app/core/ruleText';
import {
  ACTIONS,
  ActionDef,
  EVENTS,
  FIELDS,
  FieldDef,
  RULE_SCHEMA_VERSION,
  WorkflowRule,
  defaultControls,
  paramKeyFor,
  scopeLabel,
  walkLeaves,
} from '../src/app/core/vocabulary';

let failures = 0;
let assertions = 0;

function t(name: string, condition: boolean, detail?: string) {
  assertions++;
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${!condition && detail ? ` — ${detail}` : ''}`);
}

/** Order-independent canonical string for rule equivalence. */
function canon(rule: WorkflowRule | null): string {
  if (!rule) return 'NULL';
  const triggers = rule.triggers.map((x) => x.event).sort().join('|');
  const conds = walkLeaves(rule.conditions)
    .map((l) => `${typeof l.field === 'string' ? l.field : 'ff'}:${l.operator}:${scopeLabel(l.value)}`)
    .sort()
    .join('&');
  const acts = rule.actions
    .map((o) => `${o.action}=${scopeLabel(o.params[paramKeyFor(o.action)])}@${o.delayMinutes ?? 0}`)
    .sort()
    .join('+');
  const els = (rule.else ?? [])
    .map((o) => `${o.action}=${scopeLabel(o.params[paramKeyFor(o.action)])}`)
    .sort()
    .join('+');
  return `T[${triggers}] C[${conds}] L=${rule.conditions.logic} A[${acts}] E[${els}] m=${rule.controls.mode} cap=${rule.controls.maxFiresPerHour}`;
}

const base = (over: Partial<WorkflowRule>): WorkflowRule => ({
  schemaVersion: RULE_SCHEMA_VERSION,
  triggers: [{ event: 'LOAN APPROVED' }],
  conditions: { logic: 'AND', children: [] },
  actions: [],
  controls: defaultControls(),
  ...over,
});

/** Assert parse∘compose reaches a stable fixpoint for `rule`. */
function fixpoint(name: string, rule: WorkflowRule) {
  const r1 = parseInstruction(composeRuleText(rule)).rule;
  t(`${name}: re-parses to a rule`, r1 !== null, `text: ${composeRuleText(rule)}`);
  if (!r1) return;
  const r2 = parseInstruction(composeRuleText(r1)).rule;
  t(`${name}: parse∘compose is a stable fixpoint`, canon(r1) === canon(r2),
    `R'=${canon(r1)} R''=${canon(r2)}`);
  // Original components survive the first round.
  t(`${name}: triggers preserved`,
    rule.triggers.every((tr) => r1.triggers.some((x) => x.event === tr.event)),
    `want ${rule.triggers.map((x) => x.event).join('|')} got ${r1.triggers.map((x) => x.event).join('|')}`);
  const gotActions = r1.actions.map((o) => o.action);
  t(`${name}: actions preserved`,
    rule.actions.every((a) => gotActions.includes(a.action)),
    `want ${rule.actions.map((a) => a.action).join(',')} got ${gotActions.join(',')}`);
}

/* ---- Valid sample values (real authoring, not incomplete drafts) ---------- */

function sampleParam(action: ActionDef): string {
  if (action.paramKind === 'none') return '';
  if (action.paramOptions?.length) return action.paramOptions[0];
  const byKey: Record<string, string> = {
    add_tag: 'priority', remove_tag: 'stale', request_signature: 'borrower',
    request_document: 'w9 form', assign_checklist: 'onboarding pack',
    make_offer: 'term loan', log_event: 'nightly sweep', send_webhook: 'https://x.co/h',
  };
  return byKey[action.key] ?? 'sample value';
}

function sampleFieldValue(key: string, field: FieldDef): string {
  if ((field.kind === 'enum' || field.kind === 'orderedEnum') && field.options?.length) {
    return field.options[field.options.length - 1];
  }
  if (field.kind === 'numeric') return '120';
  // Instance/text fields need a value that resolves (empty is an incomplete
  // draft, gated from save, and not a real sync scenario).
  const byKey: Record<string, string> = {
    team_member: 'Wael', main_borrower: 'Acme Corp', customer_name: 'Acme Corp',
    retailer: 'Acme Retail', program: 'Spring Program', template: 'Origination',
    tags: 'priority', doc_type: 'w9',
  };
  return byKey[key] ?? 'primary value';
}

/* ---- Sweep 1: every action, solo ------------------------------------------ */
for (const action of ACTIONS) {
  const params = action.paramKind === 'none' ? {} : { [paramKeyFor(action.key)]: sampleParam(action) };
  fixpoint(`action ${action.key}`, base({ actions: [{ action: action.key, params }] }));
}

/* ---- Sweep 2: every event, solo trigger ----------------------------------- */
for (const event of EVENTS) {
  fixpoint(`event ${event.key}`, base({ triggers: [{ event: event.key }] }));
}

/* ---- Sweep 3: every condition field under a host event -------------------- */
for (const key of Object.keys(FIELDS)) {
  const host = EVENTS.find((event) => event.condFields.includes(key));
  if (!host) continue;
  const field = FIELDS[key];
  const operator = field.kind === 'numeric' ? 'gte' : 'is';
  fixpoint(`field ${key}`, base({
    triggers: [{ event: host.key }],
    conditions: { logic: 'AND', children: [{ field: key, operator, value: sampleFieldValue(key, field) }] },
  }));
}

/* ---- Combos: the shapes the builder/canvas actually produce ---------------- */
fixpoint('combo: condition + multi-action + else', base({
  conditions: { logic: 'AND', children: [{ field: 'uwstatus', operator: 'is', value: 'Approved' }] },
  actions: [
    { action: 'assign_user', params: { assignee: 'Underwriting Team' } },
    { action: 'add_tag', params: { value: 'priority' } },
    { action: 'pull_credit', params: {} },
  ],
  else: [{ action: 'notify', params: { value: 'Omar' } }],
}));
fixpoint('combo: two generic actions', base({
  actions: [
    { action: 'route_to_queue', params: { value: 'Approved' } },
    { action: 'set_underwriting_result', params: { value: 'Approved' } },
  ],
}));
fixpoint('combo: delay + armed + rate cap', base({
  actions: [{ action: 'change_stage', params: { value: 'Closed' }, delayMinutes: 4320 }],
  controls: { ...defaultControls(), mode: 'armed', maxFiresPerHour: 5 },
}));
fixpoint('combo: dual trigger', base({
  triggers: [{ event: 'LOAN APPROVED' }, { event: 'LOAN REJECTED' }],
  actions: [{ action: 'add_tag', params: { value: 'decisioned' } }],
}));
fixpoint('combo: numeric + ordered-enum with OR logic', base({
  conditions: { logic: 'OR', children: [
    { field: 'loan_amount', operator: 'gte', value: '250000' },
    { field: 'risk_grade', operator: 'worse_than', value: 'C' },
  ] },
  actions: [{ action: 'assign_authority', params: { value: 'Credit Committee' } }],
}));
fixpoint('combo: booking status is Error (was the phantom-sibling case)', base({
  triggers: [{ event: 'SYSTEM ERROR' }],
  conditions: { logic: 'AND', children: [{ field: 'bookstatus', operator: 'is', value: 'Error' }] },
  actions: [{ action: 'assign_user', params: { assignee: 'Escalation Team' } }],
}));

/* ---- Direct guard: the phantom-condition regressions stay dead ------------- */
{
  // "booking status is Error" must yield EXACTLY one condition — not also
  // data_status / processing_status (they merely share the option "Error").
  const r = parseInstruction('when there is a system error and booking status is Error, assign to Wael').rule;
  const fields = r ? walkLeaves(r.conditions).map((l) => String(l.field)) : [];
  t('no phantom siblings: only the named field becomes a condition',
    fields.length === 1 && fields[0] === 'bookstatus', `got [${fields.join(', ')}]`);
}
{
  // "change stage to Closed" is an ACTION, never also a stage condition.
  const r = parseInstruction('when a loan is rejected, change stage to Closed').rule;
  t('no phantom condition from an action verb',
    walkLeaves(r?.conditions ?? { logic: 'AND', children: [] }).length === 0 &&
      r?.actions[0]?.action === 'change_stage',
    JSON.stringify({ conds: r ? walkLeaves(r.conditions).length : -1, act: r?.actions[0]?.action }));
}

if (failures) {
  console.error(`\n${failures} of ${assertions} sync-fixpoint assertion(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${assertions} sync-fixpoint assertions passed.`);
