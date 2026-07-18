/**
 * Rule-text round-trip contract (Phase 1.6: builder ⇄ parser sync).
 *
 * composeRuleText(rule) must produce a description that parseInstruction reads
 * back to an equivalent rule for the parser-covered vocabulary subset. Where
 * the parser's whole-sentence rough matching adds extra AND conditions
 * (distinctive enum options leaking across clauses), the round-trip contract
 * is: triggers, actions, else-lane, logic, and every ORIGINAL condition
 * survive exactly — the parsed rule may only be a conditions-superset.
 *
 * Run: npx tsx core-tests/assert-rule-text.ts
 */
import { parseInstruction } from '../src/app/core/nlParser';
import { actionPhrase, composeRuleText, conditionPhrase } from '../src/app/core/ruleText';
import {
  RULE_SCHEMA_VERSION,
  RuleOutput,
  STARTER_TEMPLATES,
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

const condKeys = (rule: WorkflowRule): string[] =>
  walkLeaves(rule.conditions)
    .map((c) => `${typeof c.field === 'string' ? c.field : 'ff'}|${c.operator}|${scopeLabel(c.value)}`)
    .sort();

const actionKeys = (outputs: RuleOutput[]): string[] =>
  outputs.map(
    (o) => `${o.action}|${scopeLabel(o.params[paramKeyFor(o.action)])}|${o.delayMinutes ?? 0}`
  );

function roundTrip(
  name: string,
  rule: WorkflowRule,
  opts: { exactConditions?: boolean } = {}
) {
  const text = composeRuleText(rule);
  const parsed = parseInstruction(text).rule;
  t(`${name}: text re-parses to a rule`, parsed !== null, `text: ${text}`);
  if (!parsed) return;
  t(
    `${name}: triggers survive`,
    JSON.stringify(parsed.triggers.map((x) => x.event).sort()) ===
      JSON.stringify(rule.triggers.map((x) => x.event).sort()),
    `got ${parsed.triggers.map((x) => x.event).join('|')}`
  );
  t(
    `${name}: actions survive`,
    JSON.stringify(actionKeys(parsed.actions)) === JSON.stringify(actionKeys(rule.actions)),
    `got ${actionKeys(parsed.actions).join(' + ')}`
  );
  t(
    `${name}: else lane survives`,
    JSON.stringify(actionKeys(parsed.else ?? [])) === JSON.stringify(actionKeys(rule.else ?? [])),
    `got ${actionKeys(parsed.else ?? []).join(' + ')}`
  );
  const parsedConds = condKeys(parsed);
  const ruleConds = condKeys(rule);
  if (opts.exactConditions === false) {
    t(
      `${name}: every original condition survives (superset allowed)`,
      ruleConds.every((c) => parsedConds.includes(c)),
      `missing ${ruleConds.filter((c) => !parsedConds.includes(c)).join(', ')}`
    );
  } else {
    t(
      `${name}: conditions round-trip exactly`,
      JSON.stringify(parsedConds) === JSON.stringify(ruleConds),
      `got [${parsedConds.join(' & ')}] want [${ruleConds.join(' & ')}]`
    );
  }
  if (walkLeaves(rule.conditions).length > 1) {
    t(`${name}: logic survives`, parsed.conditions.logic === rule.conditions.logic);
  }
  t(`${name}: controls mode survives`, parsed.controls.mode === rule.controls.mode);
}

const base = (over: Partial<WorkflowRule>): WorkflowRule => ({
  schemaVersion: RULE_SCHEMA_VERSION,
  triggers: [{ event: 'LOAN APPROVED' }],
  conditions: { logic: 'AND', children: [] },
  actions: [],
  controls: defaultControls(),
  ...over,
});

/* ---- Starter templates (the demo's own rules) ---------------------------- */
// SYSTEM ERROR / FISERV LOAN texts legitimately rough-match extra status
// conditions (distinctive "Error" options) — superset contract for those two.
roundTrip('starter booking-error', STARTER_TEMPLATES[0].rule, { exactConditions: false });
roundTrip('starter auto-assign', STARTER_TEMPLATES[1].rule);
roundTrip('starter large-loan', STARTER_TEMPLATES[2].rule);
roundTrip('starter fiserv-failure', STARTER_TEMPLATES[3].rule, { exactConditions: false });

/* ---- Builder-authored shapes --------------------------------------------- */
roundTrip('trigger only', base({}));
roundTrip(
  'numeric operators',
  base({
    conditions: {
      logic: 'AND',
      children: [
        { field: 'loan_amount', operator: 'gte', value: '250000' },
        { field: 'ltv', operator: 'lt', value: '80' },
      ],
    },
    actions: [{ action: 'assign_user', params: { assignee: 'Wael' } }],
  })
);
roundTrip(
  'orderedEnum worse_than with OR logic',
  base({
    conditions: {
      logic: 'OR',
      children: [
        { field: 'risk_grade', operator: 'worse_than', value: 'B' },
        { field: 'loan_amount', operator: 'gt', value: '1000000' },
      ],
    },
    actions: [{ action: 'assign_authority', params: { value: 'Credit Committee' } }],
  })
);
roundTrip(
  'is_not enum (label-adjacent binding)',
  base({
    conditions: { logic: 'AND', children: [{ field: 'stage', operator: 'is_not', value: 'Closed' }] },
    actions: [{ action: 'notify', params: { value: 'Sara' } }],
  })
);
roundTrip(
  'multi-action with else lane',
  base({
    conditions: { logic: 'AND', children: [{ field: 'uwstatus', operator: 'is', value: 'Approved' }] },
    actions: [
      { action: 'assign_user', params: { assignee: 'Underwriting Team' } },
      { action: 'add_tag', params: { value: 'priority' } },
    ],
    else: [{ action: 'notify', params: { value: 'Omar' } }],
  })
);
roundTrip(
  'change_stage with SLA delay',
  base({ actions: [{ action: 'change_stage', params: { value: 'Approved' }, delayMinutes: 2880 }] }),
  { exactConditions: false } // "change stage to Approved" rough-matches a stage condition
);
roundTrip(
  'dual trigger: loan approved or rejected',
  base({
    triggers: [{ event: 'LOAN APPROVED' }, { event: 'LOAN REJECTED' }],
    actions: [{ action: 'add_tag', params: { value: 'decisioned' } }],
  })
);
roundTrip(
  'dual trigger: offer accepted or rejected',
  base({
    triggers: [{ event: 'OFFER ACCEPTED' }, { event: 'OFFER REJECTED' }],
    actions: [{ action: 'notify', params: { value: 'Layla' } }],
  })
);
roundTrip(
  'unconfirmed event via direct key mention',
  base({
    triggers: [{ event: 'REQUEST STAGE CHANGED' }],
    conditions: { logic: 'AND', children: [{ field: 'team_member', operator: 'is', value: 'Wael' }] },
    actions: [{ action: 'notify', params: { value: 'Wael' } }],
  })
);
roundTrip(
  'close request',
  base({ triggers: [{ event: 'OFFER REJECTED' }], actions: [{ action: 'close_request', params: {} }] })
);

/* ---- Armed-mode / rate-cap suffixes -------------------------------------- */
{
  const rule = base({
    actions: [{ action: 'assign_user', params: { assignee: 'Wael' } }],
    controls: { ...defaultControls(), mode: 'armed', maxFiresPerHour: 10 },
  });
  const text = composeRuleText(rule);
  const parsed = parseInstruction(text);
  t('armed mode survives the suffix sentence', parsed.rule?.controls.mode === 'armed');
  t('rate cap survives the suffix sentence', parsed.rule?.controls.maxFiresPerHour === 10);
}

/* ---- Parser-uncovered actions stay readable and honestly uncovered ------- */
{
  const rule = base({
    actions: [
      { action: 'route_to_queue', params: { value: 'Approved' } },
      { action: 'pull_credit', params: {} },
      { action: 'remove_tag', params: { value: 'stale' } },
    ],
  });
  const text = composeRuleText(rule);
  t('uncovered actions render readable phrases', /move it into the Approved queue/.test(text) && /pull credit/.test(text) && /remove tag stale/.test(text));
  const parsed = parseInstruction(text);
  t(
    'uncovered actions surface as uncovered fragments on re-parse (never silently vanish)',
    parsed.uncovered.length > 0
  );
}

/* ---- Phrase helpers ------------------------------------------------------- */
t(
  'currency numeric renders with $ and thousands separators',
  conditionPhrase({ field: 'loan_amount', operator: 'gte', value: '250000' }) ===
    'loan amount is at least $250,000'
);
t(
  'valueless operators render without a value token',
  conditionPhrase({ field: 'loan_amount', operator: 'is_empty', value: '' }) === 'loan amount is empty'
);
t(
  'assign_user phrase names the assignee',
  actionPhrase({ action: 'assign_user', params: { assignee: 'Wael' } }) === 'assign to Wael'
);
t(
  'delay suffix uses the shortest exact phrase',
  actionPhrase({ action: 'change_stage', params: { value: 'Approved' }, delayMinutes: 2880 }) ===
    'change stage to Approved after 2 days'
);
t(
  'ScopeRef values render their label, never [object Object]',
  !composeRuleText(
    base({
      conditions: {
        logic: 'AND',
        children: [
          {
            field: 'template',
            operator: 'is',
            value: { level: 'instance', id: 't-1', label: 'Auto Loan' },
          },
        ],
      },
    })
  ).includes('[object')
);

if (failures) {
  console.error(`\n${failures} of ${assertions} rule-text assertion(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${assertions} rule-text round-trip assertions passed.`);
