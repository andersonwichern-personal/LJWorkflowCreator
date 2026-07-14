/**
 * Deterministic client-side parser: natural-language instruction → WorkflowRule.
 *
 * Fully deterministic on purpose (Foundation Brief §6): the demo chat path must
 * never do anything non-deterministic on stage. It can graduate to a real LLM
 * later, but the structured target stays the same.
 *
 * Hardening Phase 0 (plan §2): the parser is honest —
 * - REJECT, DON'T COERCE (N1): unknown assignees/values become UnresolvedSlots
 *   with fuzzy suggestions, never fabricated params.
 * - COVERAGE (N2): consumed character spans are tracked; leftover fragments the
 *   parser did not understand are surfaced in `uncovered`.
 * - AMBIGUITY (N3): generic keywords with competing readings return a question,
 *   not a guess (`forceEvent` re-runs with the user's pick).
 * - NEGATION (N4): "don't assign…" clauses are excluded and noted.
 */

import {
  EVENTS,
  FIELDS,
  FieldDef,
  allowedFieldsForEvent,
  ASSIGNEES,
  WorkflowRule,
  RuleCondition,
  RuleOutput,
  CondLogic,
  opLabel,
  paramKeyFor,
  RULE_SCHEMA_VERSION,
  condFieldLabel,
  condFieldKind,
  isValuelessOperator,
} from "./vocabulary";
import { fuzzyMatches } from "./fuzzy";

/* -------------------------------------------------------------------------- */
/* Result contract (hardening plan §1d)                                       */
/* -------------------------------------------------------------------------- */

export interface UnresolvedSlot {
  where: "action-param" | "condition-value" | "event";
  actionIndex?: number;
  conditionIndex?: number;
  param?: string;
  /** Raw captured text the author wrote. */
  heard: string;
  /** Fuzzy matches from the (live) option list. */
  suggestions: string[];
}

export interface ParseAmbiguity {
  question: string;
  options: string[];
}

export interface ParseOptions {
  /** Resolve an ambiguity by forcing the trigger event. */
  forceEvent?: string;
  /** Live assignee names (falls back to the static ASSIGNEES). */
  assignees?: string[];
  /** Live option lists per field key (from the demo-bridge overlay). */
  instanceOptions?: Record<string, string[]>;
}

export interface ParseResult {
  rule: WorkflowRule | null;
  notes: string[];
  /** Sidecar only — NEVER persisted into rule JSON. */
  unresolved: UnresolvedSlot[];
  /** Input fragments the parser did not consume (N2). */
  uncovered: string[];
  ambiguities: ParseAmbiguity[];
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Consumed [start, end) spans over the normalized text (N2 coverage). */
type Spans = Array<[number, number]>;

function consume(spans: Spans, start: number, length: number) {
  if (length > 0) spans.push([start, start + length]);
}

/** Words that don't count toward an "uncovered fragment" (connectors/noise). */
const STOPWORDS = new Set([
  "when", "if", "then", "and", "or", "the", "a", "an", "is", "are", "to", "it",
  "this", "that", "there", "on", "for", "of", "with", "in", "fires", "please",
]);

/** Merge spans and return ≥3-content-word gaps the parser never consumed. */
function uncoveredFragments(text: string, spans: Spans): string[] {
  const merged: Spans = [];
  for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const gaps: string[] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) gaps.push(text.slice(cursor, s));
    cursor = Math.max(cursor, e);
  }
  if (cursor < text.length) gaps.push(text.slice(cursor));

  return gaps
    .map((g) => g.replace(/^[\s,.;]+|[\s,.;]+$/g, ""))
    .filter((g) => {
      const words = g.split(/[^a-z0-9$-]+/).filter((w) => w && !STOPWORDS.has(w));
      return words.length >= 3;
    });
}

/* -------------------------------------------------------------------------- */
/* Event matching (N3: ambiguity → question, not guess)                        */
/* -------------------------------------------------------------------------- */

/** Keywords that drive event inference; consumed for coverage accounting. */
const EVENT_KEYWORD_RE =
  /\b(error|failed|failure|approved|approval|rejected|denied|declined|offer|accepts?|accepted|fiserv|fmac|document|signature)\b/g;

function consumeEventKeywords(text: string, spans: Spans) {
  for (const m of text.matchAll(EVENT_KEYWORD_RE)) {
    consume(spans, m.index ?? 0, m[0].length);
  }
}

function matchEvent(
  text: string,
  spans: Spans,
  forceEvent?: string
): { event: string | null; ambiguity: ParseAmbiguity | null } {
  if (forceEvent) {
    consumeEventKeywords(text, spans);
    return { event: forceEvent, ambiguity: null };
  }

  // Direct event-key mention wins outright (longest first).
  const hits = EVENTS.map((e) => e.key).filter((k) => text.includes(norm(k)));
  if (hits.length) {
    const key = hits.sort((a, b) => b.length - a.length)[0];
    consume(spans, text.indexOf(norm(key)), norm(key).length);
    return { event: key, ambiguity: null };
  }

  const hasDocument = /\bdocument\b/.test(text);
  const hasOffer = /\boffer\b/.test(text);

  const err = /\b(error|failed|failure|booking error)\b/.exec(text);
  if (err) {
    consume(spans, err.index, err[0].length);
    return { event: "SYSTEM ERROR", ambiguity: null };
  }

  const approved = /\b(approved|approval)\b/.exec(text);
  if (approved) {
    if (hasDocument) {
      return {
        event: null,
        ambiguity: {
          question: "Did you mean loan approval or document approval?",
          options: ["LOAN APPROVED", "DOCUMENT APPROVED"],
        },
      };
    }
    consume(spans, approved.index, approved[0].length);
    return { event: "LOAN APPROVED", ambiguity: null };
  }

  const rejected = /\b(rejected|denied|declined)\b/.exec(text);
  if (rejected) {
    if (hasDocument) {
      return {
        event: null,
        ambiguity: {
          question: "Did you mean loan rejection or document rejection?",
          options: ["LOAN REJECTED", "DOCUMENT REJECTED"],
        },
      };
    }
    if (hasOffer) {
      return {
        event: null,
        ambiguity: {
          question: "Did you mean the loan being rejected or the offer being declined?",
          options: ["LOAN REJECTED", "OFFER REJECTED"],
        },
      };
    }
    consume(spans, rejected.index, rejected[0].length);
    return { event: "LOAN REJECTED", ambiguity: null };
  }

  const offerAccept = /\boffer\b.*\baccept/.exec(text) ?? /\baccept.*\boffer\b/.exec(text);
  if (offerAccept) {
    consume(spans, offerAccept.index, offerAccept[0].length);
    return { event: "OFFER ACCEPTED", ambiguity: null };
  }

  const core = /\b(fiserv|fmac)\b/.exec(text);
  if (core) {
    consume(spans, core.index, core[0].length);
    return { event: core[1] === "fiserv" ? "FISERV LOAN" : "FMAC LOAN", ambiguity: null };
  }

  return { event: null, ambiguity: null };
}

function matchLogic(text: string): CondLogic {
  return /\bor\b/.test(text) && !/\bother\b/.test(text) ? "OR" : "AND";
}

/* -------------------------------------------------------------------------- */
/* Conditions                                                                 */
/* -------------------------------------------------------------------------- */

/** Enum options distinctive enough to imply their field without naming it. */
function isDistinctive(opt: string): boolean {
  const generic = ["approved", "rejected", "assigned", "unassigned", "sent", "all", "done"];
  return opt.length > 3 && !generic.includes(opt.toLowerCase());
}

/** Parse "250k", "$1.2 million", "250,000" → integer string. */
function parseAmount(raw: string): string | null {
  const m = /\$?\s*([\d.,]+)\s*(k|m|thousand|million)?/i.exec(raw);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (isNaN(n)) return null;
  const suffix = m[2]?.toLowerCase();
  if (suffix === "k" || suffix === "thousand") n *= 1000;
  if (suffix === "m" || suffix === "million") n *= 1000000;
  return String(Math.round(n));
}

/** Fields whose text values name platform instances → must resolve or slot. */
const INSTANCE_FIELDS = new Set([
  "retailer",
  "customer_name",
  "template",
  "team_member",
  "main_borrower",
  "program",
]);

/** Option list for an instance-shaped field: live overlay first, then static. */
function instanceListFor(field: FieldDef, opts?: ParseOptions): string[] | null {
  const live = opts?.instanceOptions?.[field.key];
  if (live?.length) return live;
  if (field.options?.length) return field.options;
  return null;
}

function matchConditions(
  text: string,
  eventKey: string,
  spans: Spans,
  opts: ParseOptions | undefined,
  unresolved: UnresolvedSlot[]
): RuleCondition[] {
  const conds: RuleCondition[] = [];
  const allowed = allowedFieldsForEvent(eventKey);

  for (const field of allowed) {
    const labelN = norm(field.label);
    const labelIdx = text.indexOf(labelN);
    const fieldMentioned = labelIdx >= 0 || text.includes(field.key);

    if (field.kind === "orderedEnum" && field.options) {
      // "risk grade worse than B" / "grade better than C"
      const re = new RegExp(
        `${escapeRe(labelN)}\\s+(?:is\\s+)?(worse than|better than)\\s+(${field.options.map(escapeRe).join("|")})\\b`,
        "i"
      );
      const m = re.exec(text);
      if (m) {
        consume(spans, m.index, m[0].length);
        conds.push({
          field: field.key,
          operator: m[1] === "worse than" ? "worse_than" : "better_than",
          value: m[2].toUpperCase(),
        });
        continue;
      }
    }

    if ((field.kind === "enum" || field.kind === "orderedEnum") && field.options) {
      for (const opt of field.options) {
        const optN = norm(opt);
        // Short options (grades "A"–"E") need word boundaries + the field named;
        // plain includes() would match single letters anywhere.
        const optRe = new RegExp(`\\b${escapeRe(optN)}\\b`);
        const optIdx =
          optN.length <= 3 ? (optRe.exec(text)?.index ?? -1) : text.indexOf(optN);
        if (optIdx === -1) continue;
        const negated = new RegExp(`(is not|isn't|not)\\s+${escapeRe(optN)}`).test(text);
        const applies =
          optN.length <= 3
            ? fieldMentioned
            : (fieldMentioned && text.includes(optN)) || isDistinctive(opt);
        if (applies) {
          if (labelIdx >= 0) consume(spans, labelIdx, labelN.length);
          consume(spans, optIdx, optN.length);
          conds.push({ field: field.key, operator: negated ? "is_not" : "is", value: opt });
          break;
        }
      }
    } else if (field.kind === "numeric") {
      // e.g. "loan amount over 250k", "amount is at least $1 million"
      const re = new RegExp(
        `${escapeRe(labelN)}\\s+((?:is\\s+)?(?:over|above|greater than|more than|at least|under|below|less than|at most)|>=|>|<=|<|is|of|=)?\\s*\\$?([\\d.,]+\\s*(?:k|m|thousand|million)?)`
      );
      const m = re.exec(text);
      if (m) {
        const amount = parseAmount(m[2]);
        if (amount) {
          consume(spans, m.index, m[0].length);
          const opWord = (m[1] ?? "").trim();
          let operator = "is";
          if (/over|above|greater than|more than|>/.test(opWord)) operator = "gt";
          else if (/at least|>=/.test(opWord)) operator = "gte";
          else if (/under|below|less than|</.test(opWord)) operator = "lt";
          else if (/at most|<=/.test(opWord)) operator = "lte";
          conds.push({ field: field.key, operator, value: amount });
        }
      }
    } else if (field.kind === "text") {
      const re = new RegExp(
        `${escapeRe(labelN)}\\s+(?:is|=|:|of)\\s+([a-z0-9 &._-]{2,40}?)(?:\\s+(?:and|or|then)\\b|\\s*[,.;]|$)`
      );
      const m = re.exec(text);
      if (m) {
        const heard = m[1].trim();
        consume(spans, m.index, m[0].length);
        // N1 for instance-shaped fields: resolve against the registry or slot.
        const list = INSTANCE_FIELDS.has(field.key) ? instanceListFor(field, opts) : null;
        if (list) {
          const exact = list.find((o) => norm(o) === heard);
          if (exact) {
            conds.push({ field: field.key, operator: "is", value: exact });
          } else {
            conds.push({ field: field.key, operator: "is", value: "" });
            unresolved.push({
              where: "condition-value",
              conditionIndex: conds.length - 1,
              heard,
              suggestions: fuzzyMatches(heard, list),
            });
          }
        } else {
          conds.push({ field: field.key, operator: "is", value: titleCase(heard) });
        }
      }
    }
  }
  return conds;
}

/* -------------------------------------------------------------------------- */
/* Outputs (N1 reject-don't-coerce, N4 negation)                              */
/* -------------------------------------------------------------------------- */

function matchOutputs(
  text: string,
  spans: Spans,
  opts: ParseOptions | undefined,
  unresolved: UnresolvedSlot[],
  notes: string[]
): RuleOutput[] {
  const outputs: RuleOutput[] = [];
  const assigneeList = opts?.assignees?.length ? opts.assignees : ASSIGNEES;

  // N4: exclude negated instructions before matching, and note each one.
  const excluded = new Set<string>();
  const negRe =
    /(?:don't|do not|never|without)\s+((assign|route|escalate|notify|close|tag|change)\b[a-z0-9 ._-]*?)(?=\s*(?:,|\.|;|$|\band\b|\bthen\b))/g;
  for (const m of text.matchAll(negRe)) {
    const verb = m[2] === "route" || m[2] === "escalate" ? "assign" : m[2];
    excluded.add(verb);
    consume(spans, m.index ?? 0, m[0].length);
    notes.push(`Ignored negated instruction: "${m[1].trim()}".`);
  }

  /** Resolve a captured name against a registry; slot it when unknown (N1). */
  function pushResolved(action: "assign_user" | "notify", heard: string) {
    const param = paramKeyFor(action);
    const exact = assigneeList.find((a) => norm(a) === norm(heard));
    if (exact) {
      outputs.push({ action, params: { [param]: exact } });
    } else {
      outputs.push({ action, params: {} });
      unresolved.push({
        where: "action-param",
        actionIndex: outputs.length - 1,
        param,
        heard,
        suggestions: fuzzyMatches(heard, assigneeList),
      });
    }
  }

  // assign / route / escalate to <name>
  if (!excluded.has("assign")) {
    const assign =
      /(?:assign|route|escalate|send it|send this)\s+(?:it\s+|this\s+)?to\s+([a-z0-9 ._-]{2,40}?)(?:\s+(?:and|then|,|\.)|$)/.exec(
        text
      );
    if (assign) {
      consume(spans, assign.index, assign[0].length);
      pushResolved("assign_user", assign[1].trim());
    }
  }

  // notify <name>
  if (!excluded.has("notify")) {
    const notify = /notify\s+([a-z0-9 ._-]{2,40}?)(?:\s+(?:and|then|,|\.)|$)/.exec(text);
    if (notify) {
      consume(spans, notify.index, notify[0].length);
      pushResolved("notify", notify[1].trim());
    }
  }

  // change / set / move stage to <stage>
  if (!excluded.has("change")) {
    const stage =
      /(?:change|set|move)\s+(?:the\s+)?stage\s+to\s+([a-z ]{3,20}?)(?:\s+(?:and|then|,|\.)|$)/.exec(
        text
      );
    if (stage) {
      consume(spans, stage.index, stage[0].length);
      const heard = stage[1].trim();
      const options = FIELDS.stage.options ?? [];
      const exact = options.find((o) => norm(o) === norm(heard));
      if (exact) {
        outputs.push({ action: "change_stage", params: { value: exact } });
      } else {
        outputs.push({ action: "change_stage", params: {} });
        unresolved.push({
          where: "action-param",
          actionIndex: outputs.length - 1,
          param: paramKeyFor("change_stage"),
          heard,
          suggestions: fuzzyMatches(heard, options),
        });
      }
    }
  }

  // add tag <tag> — tags are self-identifying free text (hardening §4); normalize only.
  if (!excluded.has("tag")) {
    const tag = /add\s+(?:a\s+)?tag\s+([a-z0-9 _-]{2,30}?)(?:\s+(?:and|then|,|\.)|$)/.exec(text);
    if (tag) {
      consume(spans, tag.index, tag[0].length);
      outputs.push({ action: "add_tag", params: { value: tag[1].trim().replace(/\s+/g, " ") } });
    }
  }

  // close the request
  if (!excluded.has("close")) {
    const close = /close\s+(?:the\s+)?request/.exec(text);
    if (close) {
      consume(spans, close.index, close[0].length);
      outputs.push({ action: "close_request", params: {} });
    }
  }

  return outputs;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function parseInstruction(input: string, opts?: ParseOptions): ParseResult {
  const notes: string[] = [];
  const unresolved: UnresolvedSlot[] = [];
  const spans: Spans = [];
  const text = norm(input);
  if (!text) {
    return {
      rule: null,
      notes: ["Type an instruction to draft a rule."],
      unresolved: [],
      uncovered: [],
      ambiguities: [],
    };
  }

  const { event: eventKey, ambiguity } = matchEvent(text, spans, opts?.forceEvent);
  if (ambiguity) {
    // N3: never guess between competing readings — ask.
    return { rule: null, notes: [ambiguity.question], unresolved: [], uncovered: [], ambiguities: [ambiguity] };
  }
  if (!eventKey) {
    return {
      rule: null,
      notes: [
        "Couldn't identify a trigger event. Try one of: " +
          EVENTS.filter((e) => e.confidence === "verified")
            .map((e) => e.label)
            .join(", ") +
          ".",
      ],
      unresolved: [],
      uncovered: [],
      ambiguities: [],
    };
  }

  const conds = matchConditions(text, eventKey, spans, opts, unresolved);
  const outputs = matchOutputs(text, spans, opts, unresolved, notes);
  const condLogic = matchLogic(text);
  const uncovered = uncoveredFragments(text, spans);

  notes.push(`Event → ${eventKey}.`);
  if (conds.length) {
    notes.push(
      "Conditions → " +
        conds
          .map((c) => {
            const label = condFieldLabel(c.field);
            const op = opLabel(condFieldKind(c.field), c.operator);
            return isValuelessOperator(c.operator)
              ? `${label} ${op}`
              : `${label} ${op} ${c.value || "(pick a value)"}`;
          })
          .join(` ${condLogic} `) +
        "."
    );
  } else {
    notes.push("No conditions matched (fires on every event of this type).");
  }
  if (outputs.length) {
    notes.push(
      "Actions → " +
        outputs
          .map((o) => {
            const key = paramKeyFor(o.action);
            return `${o.action.replace(/_/g, " ")}${o.params[key] ? " " + o.params[key] : ""}`;
          })
          .join("; ") +
        "."
    );
  } else {
    notes.push('No action matched. Add one like "assign to Wael".');
  }
  for (const slot of unresolved) {
    notes.push(`Needs your pick: ${slot.param ?? "value"} (heard "${slot.heard}").`);
  }

  return {
    rule: {
      schemaVersion: RULE_SCHEMA_VERSION,
      trigger: { event: eventKey },
      conditions: { logic: condLogic, rules: conds },
      actions: outputs,
    },
    notes,
    unresolved,
    uncovered,
    ambiguities: [],
  };
}
