import { ACTIONS, ASSIGNEES, EVENTS, FIELDS, OPERATORS } from '../../../core/vocabulary';

/**
 * Predictive ghost-text engine for the AI Workflow Assistant composer.
 *
 * Deterministic and framework-free: given the partial instruction the operator
 * has typed, it returns the predicted CONTINUATION — the exact suffix that,
 * appended to the current text, extends their phrase. The composer renders that
 * suffix as muted ghost text in a sub-bar; Tab / → / clicking the chip accepts.
 *
 * It is grounded in the LIVE vocabulary (`@sweet/rule-core`) — events, trigger
 * fields, operators, assignees, and actions all feed the phrase bank — plus a
 * curated set of common operational connectives, so predictions always speak
 * the domain's language instead of a generic autocomplete's.
 *
 * This lives in the Angular UI layer on purpose: it is a composer affordance,
 * not rule semantics, so it stays out of the pure rule core and its sync gate.
 */

/** A context → next-clause rule. `re` is matched against the lowercased tail of
 *  what the operator has typed; when it fires, `add` is the predicted suffix. */
interface ClauseRule {
  re: RegExp;
  add: string;
  /** Skip when the text already contains an action verb (don't double-suggest). */
  unlessAction?: boolean;
  /** Skip when the text already notifies someone. */
  unlessNotify?: boolean;
}

/** Detects any output verb already present, so we never suggest a second one. */
const ACTION_PRESENT =
  /\b(assign(ed)? to|notif|route|change stage|set underwriting|run |add tag|remove tag|close|request (a )?(signature|document)|assign checklist|pull credit|make (an )?offer|trigger booking|log event|send webhook)/;

const NOTIFY_PRESENT = /\bnotif/;

/**
 * Context rules, highest-value first. These fire at natural continuation points
 * — right after a recognized trigger, or after a verb that expects an argument
 * — and predict the canonical next clause. The marquee case is the first rule:
 * finishing a trigger word ("…is approved") predicts a full, grounded action
 * clause, e.g. "When a loan is approved" → ", assign to Underwriting Team and
 * notify Wael".
 */
const CLAUSE_RULES: ClauseRule[] = [
  // Completed trigger word, nothing after it yet, no action → whole action clause.
  {
    re: /\b(approved|rejected|uploaded|completed|accepted|submitted|books|created|assigned|changed)$/,
    add: ', assign to Underwriting Team and notify Wael',
    unlessAction: true,
  },
  // Just past a comma with a trigger already stated, no action → the action clause.
  {
    re: /,\s+$/,
    add: 'assign to Underwriting Team and notify Wael',
    unlessAction: true,
  },
  // Same, but the operator hasn't typed the space after the comma yet.
  {
    re: /,$/,
    add: ' assign to Underwriting Team and notify Wael',
    unlessAction: true,
  },
  // Verbs that expect an argument → the argument.
  { re: /\bassign(ed)? to\s+$/, add: 'Underwriting Team' },
  { re: /\band assign(ed)? to\s+$/, add: 'Underwriting Team' },
  { re: /\bnotify\s+$/, add: 'Wael' },
  { re: /\band notify\s+$/, add: 'Wael' },
  { re: /\bchange stage to\s+$/, add: 'Booking' },
  { re: /\bset underwriting result to\s+$/, add: 'Rejected' },
  { re: /\bset\s+$/, add: 'underwriting result to Rejected' },
  { re: /\bif the\s+$/, add: 'credit score is below 620' },
  { re: /\bif\s+$/, add: 'the credit score is below 620' },
  // Action stated but no recipient yet → add a notify clause.
  {
    re: /\b(Underwriting Team|Booking Team|Escalation Team|Operations Team|Wael|Sara|Mohammed|Aisha|Omar|Layla)$/i,
    add: ' and notify Wael',
    unlessNotify: true,
  },
];

/**
 * Ordered phrase bank for last-word completion. Curated connectives come first
 * (so they win a prefix race), then live-vocabulary terms: assignees, field
 * labels, operator labels, action labels, and natural trigger phrasings. The
 * first entry whose start matches the partial word — and is longer than it —
 * supplies the completion.
 */
const PHRASE_BANK: string[] = dedupe([
  // Curated openers + connectives (domain phrasing the vocabulary can't spell).
  'when a loan is approved',
  'when a loan is rejected',
  'when an offer is accepted',
  'when an offer is rejected',
  'when a document is uploaded',
  'when a document is approved',
  'when a fiserv loan books',
  'when a credit pull completes',
  'when a request is submitted',
  'when a signature is completed',
  'if the credit score is below 620',
  'assign to',
  'and assign to',
  'notify',
  'and notify',
  'change stage to',
  'route to the',
  'set underwriting result to',
  'run document extraction',
  'request a signature',
  'pull credit',
  'add tag',
  'approved',
  'rejected',
  'uploaded',
  'completed',
  'submitted',
  'underwriting result to',

  // Live vocabulary: assignees & teams.
  ...ASSIGNEES,

  // Live vocabulary: condition field labels ("credit score", "loan amount"…).
  ...Object.values(FIELDS).map((field) => field.label),

  // Live vocabulary: operator phrasings ("is at least", "is below"…).
  ...Object.values(OPERATORS)
    .flat()
    .map((op) => op.label),

  // Live vocabulary: action labels ("Assign checklist", "Request signature"…).
  ...ACTIONS.map((action) => action.label),

  // Live vocabulary: natural, lowercased trigger phrasings from event labels.
  ...EVENTS.map((event) => event.label.toLowerCase()),
]);

/**
 * Predict the continuation of a partial workflow instruction.
 *
 * @returns the suffix to append after the caret, or '' when there is nothing
 *   confident to suggest. The caller renders it as ghost text and appends it
 *   verbatim on accept.
 */
export function predictWorkflowGhost(text: string): string {
  if (!text.trim()) return '';
  const lower = text.toLowerCase();
  const hasAction = ACTION_PRESENT.test(lower);
  const hasNotify = NOTIFY_PRESENT.test(lower);

  for (const rule of CLAUSE_RULES) {
    if (rule.unlessAction && hasAction) continue;
    if (rule.unlessNotify && hasNotify) continue;
    if (rule.re.test(lower)) return rule.add;
  }

  return completeLastWord(text);
}

/**
 * Complete the partial phrase at the caret against the phrase bank. Tries the
 * longest trailing word-window first (up to 4 words) so multi-word terms
 * complete with their full context — "credit sc" → "credit score", not a
 * spurious single-token match on "sc".
 */
function completeLastWord(text: string): string {
  for (let words = 4; words >= 1; words--) {
    const window = text.match(new RegExp(`(\\S+(?:\\s+\\S+){${words - 1}})$`))?.[1];
    if (!window) continue;
    // One-character stubs are too ambiguous to predict from confidently.
    if (window.length < 2) continue;
    const lower = window.toLowerCase();
    for (const phrase of PHRASE_BANK) {
      if (phrase.length > window.length && phrase.toLowerCase().startsWith(lower)) {
        // Slice by the typed length so the completion carries the phrase's own
        // casing for the remainder (the typed prefix keeps the user's casing).
        return phrase.slice(window.length);
      }
    }
  }
  return '';
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}
