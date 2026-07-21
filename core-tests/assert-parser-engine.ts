/**
 * Parser engine contract (process over content).
 *
 * The engine must derive its grammar from the vocabulary, not from hardcoded
 * content: these sweeps iterate the ENTIRE vocabulary — every event, every
 * action, and every condition field — so when a client's content changes,
 * the sweep still covers it without a single test edit. Alongside the sweeps:
 * pins for the generic trigger scorer (typos/inflections resolve, ties ASK,
 * prose never hijacks), the generic action grammar (aliases, {param}
 * templates, delays, gates), negation, and legacy/generic masking.
 *
 * Run: npx tsx core-tests/assert-parser-engine.ts
 */
import { parseInstruction } from '../src/app/core/nlParser';
import { composeRuleText } from '../src/app/core/ruleText';
import {
  ACTIONS,
  ActionDef,
  EVENTS,
  FIELDS,
  RULE_SCHEMA_VERSION,
  WorkflowRule,
  defaultControls,
  getEvent,
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

const base = (over: Partial<WorkflowRule>): WorkflowRule => ({
  schemaVersion: RULE_SCHEMA_VERSION,
  triggers: [{ event: 'LOAN APPROVED' }],
  conditions: { logic: 'AND', children: [] },
  actions: [],
  controls: defaultControls(),
  ...over,
});

/* ---- Sweep 1: EVERY event round-trips as a trigger ------------------------ */
// The serializer emits a quoted direct-key mention; the parser's direct-key
// branch must read every key in the vocabulary back — including any a client
// adds later, since this loop reads the vocabulary itself.
for (const event of EVENTS) {
  const rule = base({ triggers: [{ event: event.key }] });
  const parsed = parseInstruction(composeRuleText(rule)).rule;
  t(`event sweep: ${event.key}`, parsed?.triggers[0]?.event === event.key,
    `got ${parsed?.triggers.map((x) => x.event).join('|') ?? 'null'}`);
}

/* ---- Sweep 2: EVERY action round-trips through its own vocabulary phrase -- */
function sampleParam(action: ActionDef): string {
  if (action.paramKind === 'none') return '';
  if (action.paramOptions?.length) return action.paramOptions[0];
  const byKey: Record<string, string> = {
    add_tag: 'priority review',
    remove_tag: 'stale',
    request_signature: 'borrower',
    request_document: 'w9 form',
    assign_checklist: 'onboarding pack',
    make_offer: 'term loan',
    log_event: 'nightly sweep',
    send_webhook: 'https://example.com/hooks/1',
  };
  return byKey[action.key] ?? 'sample value';
}

for (const action of ACTIONS) {
  const value = sampleParam(action);
  const params = action.paramKind === 'none' ? {} : { [paramKeyFor(action.key)]: value };
  const rule = base({ actions: [{ action: action.key, params }] });
  const parsed = parseInstruction(composeRuleText(rule)).rule;
  const hit = parsed?.actions.find((output) => output.action === action.key);
  t(`action sweep: ${action.key} parses back`, !!hit,
    `text: ${composeRuleText(rule)} → actions [${parsed?.actions.map((o) => o.action).join(', ') ?? 'null'}]`);
  if (hit && action.paramKind !== 'none') {
    const got = scopeLabel(hit.params[paramKeyFor(action.key)]);
    t(`action sweep: ${action.key} param survives`,
      got.toLowerCase() === value.toLowerCase(), `got "${got}" want "${value}"`);
  }
  t(`action sweep: ${action.key} adds exactly one action`, (parsed?.actions.length ?? 0) === 1,
    `got ${parsed?.actions.length}`);
}

/* ---- Sweep 3: EVERY condition field survives under a host event ----------- */
// The condition grammar is already vocabulary-driven; this sweep proves it
// stays total: for each field, pick an event that carries it, serialize one
// condition, and require that condition to survive a re-parse (the parser's
// rough scan may add extras — supersets are allowed, silent loss is not).
function sampleFieldValue(key: string): string {
  const field = FIELDS[key];
  if ((field.kind === 'enum' || field.kind === 'orderedEnum') && field.options?.length) {
    return field.options[field.options.length - 1];
  }
  if (field.kind === 'numeric') return '120';
  return field.options?.[0] ?? 'sample value';
}

for (const key of Object.keys(FIELDS)) {
  const host = EVENTS.find((event) => event.condFields.includes(key));
  if (!host) continue;
  const value = sampleFieldValue(key);
  const operator = FIELDS[key].kind === 'numeric' ? 'gte' : 'is';
  const rule = base({
    triggers: [{ event: host.key }],
    conditions: { logic: 'AND', children: [{ field: key, operator, value }] },
  });
  const parsed = parseInstruction(composeRuleText(rule)).rule;
  const survived = parsed
    ? walkLeaves(parsed.conditions).some(
        (leaf) =>
          leaf.field === key &&
          leaf.operator === operator &&
          scopeLabel(leaf.value).toLowerCase() === value.toLowerCase()
      )
    : false;
  t(`field sweep: ${key} condition survives re-parse`, survived,
    `text: ${composeRuleText(rule)} → ${parsed ? walkLeaves(parsed.conditions).map((l) => `${String(l.field)}:${l.operator}:${scopeLabel(l.value)}`).join(' & ') : 'null'}`);
}

/* ---- Generic trigger scorer: typos + inflections resolve ------------------ */
let r = parseInstruction('when a loan is aproved, notify sara');
t('fuzzy: typo "aproved" still resolves LOAN APPROVED',
  r.rule?.triggers[0]?.event === 'LOAN APPROVED' && r.rule?.actions[0]?.action === 'notify');

r = parseInstruction('when the request stage changes, notify wael');
t('fuzzy: inflection "changes" resolves REQUEST STAGE CHANGED',
  r.rule?.triggers[0]?.event === 'REQUEST STAGE CHANGED');

r = parseInstruction('when a credit pull completes, add tag reviewed');
t('fuzzy: inflection "completes" resolves CREDIT PULL COMPLETED',
  r.rule?.triggers[0]?.event === 'CREDIT PULL COMPLETED');

/* ---- Generic trigger scorer: near-miss ASKS, never guesses (N3) ----------- */
r = parseInstruction('when the booking status flips, notify wael');
t('near-miss: partial event phrase raises a question, no rule',
  r.rule === null && r.ambiguities.length === 1 &&
    r.ambiguities[0].options.includes('BOOKING STATUS CHANGED'),
  JSON.stringify({ rule: !!r.rule, amb: r.ambiguities }));

/* ---- Generic trigger scorer: prose never hijacks -------------------------- */
r = parseInstruction('assign to wael please');
t('no-hijack: an action-only sentence stays triggerless',
  r.rule === null && r.ambiguities.length === 0);

r = parseInstruction('make the operations run smoothly every day');
t('no-hijack: unrelated prose stays triggerless',
  r.rule === null && r.ambiguities.length === 0);

/* ---- Trigger clause scoping: a longer event key buried in a later clause
        must not flip the trigger (was FMAC LOAN -> LOAN APPROVED). --------- */
r = parseInstruction('when a fmac loan is booked, notify omar that the loan approved');
t('clause-scope: buried longer event key does not flip the trigger',
  r.rule?.triggers[0]?.event === 'FMAC LOAN',
  JSON.stringify({ triggers: r.rule?.triggers, uncovered: r.uncovered }));
t('clause-scope: the real trigger clause is not dumped into uncovered',
  !r.uncovered.some((fragment) => fragment.includes('fmac loan')),
  JSON.stringify(r.uncovered));

/* ---- Generic action grammar: alias {param} template ----------------------- */
r = parseInstruction('when a loan is approved, move it into the rejected queue');
t('alias template: mid-phrase {param} parses route_to_queue',
  r.rule?.actions.some((o) => o.action === 'route_to_queue' && o.params.value === 'Rejected') === true,
  JSON.stringify(r.rule?.actions));

/* ---- Generic action grammar: delay + unknown-enum slot -------------------- */
r = parseInstruction('when a loan is approved, request document w9 form after 1 hour');
{
  const doc = r.rule?.actions.find((o) => o.action === 'request_document');
  t('generic delay: "after 1 hour" lands on a generic action',
    doc?.delayMinutes === 60 && scopeLabel(doc?.params.value ?? '') === 'w9 form',
    JSON.stringify(r.rule?.actions));
}

r = parseInstruction('when a loan is approved, move it into the vip queue');
t('generic enum: unknown queue value → unresolved slot, never coerced',
  r.rule?.actions.some((o) => o.action === 'route_to_queue' && !o.params.value) === true &&
    r.unresolved.some((slot) => slot.heard === 'vip'),
  JSON.stringify({ actions: r.rule?.actions, unresolved: r.unresolved }));

/* ---- Negation excludes generic actions too -------------------------------- */
r = parseInstruction("when a loan is approved, don't route to queue approved, pull credit");
t('negation: negated verb suppresses the generic action as well',
  r.rule?.actions.length === 1 && r.rule?.actions[0].action === 'pull_credit',
  JSON.stringify(r.rule?.actions));

/* ---- Legacy + generic masking: no double-claiming ------------------------- */
r = parseInstruction('when a loan is approved, assign to wael and assign checklist onboarding pack');
t('masking: legacy assign and generic assign-checklist coexist',
  r.rule?.actions.some((o) => o.action === 'assign_user' && scopeLabel(o.params.assignee ?? '') === 'Wael') === true &&
    r.rule?.actions.some((o) => o.action === 'assign_checklist' && o.params.value === 'onboarding pack') === true &&
    r.rule?.actions.length === 2,
  JSON.stringify(r.rule?.actions));

/* ---- Legacy coverage pin stays intact ------------------------------------- */
r = parseInstruction('When a loan is approved, assign to wael and request tax returns');
t('coverage: a phrase matching no vocabulary label still surfaces as uncovered',
  r.uncovered.some((fragment) => fragment.includes('request tax returns')),
  JSON.stringify(r.uncovered));

/* ---- Sanity: getEvent stays total over the sweep -------------------------- */
t('vocabulary sanity: every swept event exists', EVENTS.every((event) => !!getEvent(event.key)));

if (failures) {
  console.error(`\n${failures} of ${assertions} parser-engine assertion(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${assertions} parser-engine assertions passed.`);
