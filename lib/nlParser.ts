/**
 * Deterministic client-side parser: natural-language instruction → WorkflowRule.
 *
 * Fully deterministic on purpose (Foundation Brief §6): the demo chat path must
 * never do anything non-deterministic on stage. It can graduate to a real LLM
 * later, but the structured target stays the same.
 */

import {
  EVENTS,
  FIELDS,
  allowedFieldsForEvent,
  ASSIGNEES,
  WorkflowRule,
  RuleCondition,
  RuleOutput,
  CondLogic,
  opLabel,
  paramKeyFor,
} from "./vocabulary";

export interface ParseResult {
  rule: WorkflowRule | null;
  notes: string[];
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Recover original casing for a name captured in the lowercased text. */
function fromOriginal(lowerName: string, original: string): string {
  const idx = norm(original).indexOf(lowerName);
  if (idx >= 0) {
    const slice = norm(original).slice(idx, idx + lowerName.length);
    if (slice) return titleCase(slice).trim();
  }
  return titleCase(lowerName);
}

function matchEvent(text: string): string | null {
  const hits = EVENTS.map((e) => e.key).filter((k) => text.includes(norm(k)));
  if (hits.length) return hits.sort((a, b) => b.length - a.length)[0];
  if (/\b(error|failed|failure|booking error)\b/.test(text)) return "SYSTEM ERROR";
  if (/\b(approved|approval)\b/.test(text)) return "LOAN APPROVED";
  if (/\b(rejected|denied|declined)\b/.test(text)) return "LOAN REJECTED";
  if (/\boffer\b.*\baccept/.test(text) || /\baccept.*\boffer\b/.test(text))
    return "OFFER ACCEPTED";
  if (/\bfiserv\b/.test(text)) return "FISERV LOAN";
  if (/\bfmac\b/.test(text)) return "FMAC LOAN";
  return null;
}

function matchLogic(text: string): CondLogic {
  return /\bor\b/.test(text) && !/\bother\b/.test(text) ? "OR" : "AND";
}

/** Enum options distinctive enough to imply their field without naming it. */
function isDistinctive(opt: string): boolean {
  const generic = ["approved", "rejected", "assigned", "unassigned", "sent", "all", "done"];
  return opt.length > 3 && !generic.includes(opt.toLowerCase());
}

const NUM_WORDS: Record<string, string> = {
  thousand: "000",
  k: "000",
  million: "000000",
  m: "000000",
};

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

function matchConditions(text: string, eventKey: string): RuleCondition[] {
  const conds: RuleCondition[] = [];
  const allowed = allowedFieldsForEvent(eventKey);

  for (const field of allowed) {
    const fieldMentioned = text.includes(norm(field.label)) || text.includes(field.key);

    if (field.kind === "enum" && field.options) {
      for (const opt of field.options) {
        const optN = norm(opt);
        const negated = new RegExp(`(is not|isn't|not)\\s+${escapeRe(optN)}`).test(text);
        if (
          (fieldMentioned && text.includes(optN)) ||
          (isDistinctive(opt) && text.includes(optN))
        ) {
          conds.push({ field: field.key, operator: negated ? "is_not" : "is", value: opt });
          break;
        }
      }
    } else if (field.kind === "numeric") {
      // e.g. "loan amount over 250k", "amount at least $1 million"
      const re = new RegExp(
        `${escapeRe(norm(field.label))}\\s+(over|above|greater than|more than|at least|>=|>|under|below|less than|at most|<=|<|is|of|=)?\\s*\\$?([\\d.,]+\\s*(?:k|m|thousand|million)?)`
      );
      const m = re.exec(text);
      if (m) {
        const amount = parseAmount(m[2]);
        if (amount) {
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
        `${escapeRe(norm(field.label))}\\s+(?:is|=|:|of)\\s+([a-z0-9 &._-]{2,40}?)(?:\\s+(?:and|or|then|,)|$)`
      );
      const m = re.exec(text);
      if (m) conds.push({ field: field.key, operator: "is", value: titleCase(m[1].trim()) });
    }
  }
  return conds;
}

function matchOutputs(text: string, original: string): RuleOutput[] {
  const outputs: RuleOutput[] = [];

  // assign / route / escalate to <name>
  const assign = /(?:assign|route|escalate|send it|send this)\s+(?:it\s+|this\s+)?to\s+([a-z0-9 ._-]{2,40}?)(?:\s+(?:and|then|,|\.)|$)/.exec(
    text
  );
  if (assign) {
    const raw = assign[1].trim();
    const known = ASSIGNEES.find((a) => norm(a) === norm(raw));
    outputs.push({
      action: "assign_user",
      params: { [paramKeyFor("assign_user")]: known ?? fromOriginal(raw, original) },
    });
  }

  // notify <name>
  const notify = /notify\s+([a-z0-9 ._-]{2,40}?)(?:\s+(?:and|then|,|\.)|$)/.exec(text);
  if (notify) {
    const raw = notify[1].trim();
    const known = ASSIGNEES.find((a) => norm(a) === norm(raw));
    outputs.push({ action: "notify", params: { value: known ?? fromOriginal(raw, original) } });
  }

  // change / set / move stage to <stage>
  const stage = /(?:change|set|move)\s+(?:the\s+)?stage\s+to\s+([a-z ]{3,20}?)(?:\s+(?:and|then|,|\.)|$)/.exec(
    text
  );
  if (stage) {
    const val = titleCase(stage[1].trim());
    if (FIELDS.stage.options?.some((o) => norm(o) === norm(val)))
      outputs.push({ action: "change_stage", params: { value: val } });
  }

  // add tag <tag>
  const tag = /add\s+(?:a\s+)?tag\s+([a-z0-9 _-]{2,30}?)(?:\s+(?:and|then|,|\.)|$)/.exec(text);
  if (tag) outputs.push({ action: "add_tag", params: { value: tag[1].trim() } });

  // close the request
  if (/close\s+(?:the\s+)?request/.test(text))
    outputs.push({ action: "close_request", params: {} });

  return outputs;
}

export function parseInstruction(input: string): ParseResult {
  const notes: string[] = [];
  const text = norm(input);
  if (!text) return { rule: null, notes: ["Type an instruction to draft a rule."] };

  const eventKey = matchEvent(text);
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
    };
  }

  const conds = matchConditions(text, eventKey);
  const outputs = matchOutputs(text, input);
  const condLogic = matchLogic(text);

  notes.push(`Event → ${eventKey}.`);
  if (conds.length) {
    notes.push(
      "Conditions → " +
        conds
          .map((c) => {
            const f = FIELDS[c.field];
            return `${f?.label ?? c.field} ${opLabel(f?.kind ?? "text", c.operator)} ${c.value}`;
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

  return { rule: { event: eventKey, conds, outputs, condLogic }, notes };
}
