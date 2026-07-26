/**
 * GENERATED from packages/workflow-brain/src/conversation.ts — DO NOT EDIT BY HAND.
 * Vendored copy of the @sweet/workflow-brain contract for Angular.
 * To change it, edit the package and run `npm run sync:angular-core` at
 * the repo root. `npm test` fails
 * on drift via this script's --check mode.
 */
/**
 * conversation — the conversational lane of the Workflow Brain.
 *
 * The composer's parse pipeline is honest to a fault: text it cannot ground
 * becomes a red "couldn't make that precise" notice. That is right for a
 * workflow instruction and wrong for "hello". This module gives every
 * non-workflow utterance a real assistant turn while changing NOTHING about
 * how real-but-imperfect instructions are reported:
 *
 *  - classifyUtterance decides which lane a submission belongs to, with
 *    deterministic heuristics only — a parsed rule or any workflow-vocabulary
 *    evidence keeps the utterance on the parse lane (today's honest gap
 *    reporting), social/help text goes to the chat lane;
 *  - converse mirrors hybridParse's transport mechanics (orchestrator.ts): the
 *    optional ConversationTransport is raced against a per-attempt deadline
 *    via the one allowed scheduling primitive (setTimeout), every failure
 *    class falls back onto deterministicReply with an honest fallbackReason,
 *    and an external abort propagates as BrainAbortError — never a result;
 *  - reviewChatReply is the hostile-input gate for the model's text (the chat
 *    sibling of candidateNormalization): the reply is UNTRUSTED until it is
 *    proven to be a bounded, sanitized, non-empty string;
 *  - deterministicReply is the zero-config floor: friendly, grounded in the
 *    verified vocabulary (never an unconfirmed event/action), and it never
 *    pretends a model answered.
 *
 * fallbackReason (documented rule, closed set):
 *   "no-transport"   no ConversationTransport configured — nothing failed;
 *   "timeout"        the attempt deadline elapsed before the transport settled;
 *   "transport"      the transport threw a plain failure;
 *   "shape"          the transport resolved but the reply failed reviewChatReply
 *                    (or the response carried no reply field at all);
 *   "aborted-shape"  the transport threw an abort-SHAPED error while the
 *                    caller's signal was NOT aborted — a self-cancelling
 *                    transport is misbehavior, not a caller decision, so it
 *                    falls back instead of masquerading as an abort.
 * A real caller abort (signal.aborted) always throws BrainAbortError, exactly
 * like the orchestrator's M1/M3 contract: a newer submission must never
 * receive a stale fallback reply.
 *
 * Purity: no clock reads (BrainClock is injected), no randomness, no host
 * APIs; same inputs, same classification, same deterministic reply.
 */
import type { ParseResult } from "../core/nlParser";
import { ACTIONS, ASSIGNEES, EVENTS, FIELDS } from "../core/vocabulary";
import { classifyTransportError, TransportTimeoutError } from "./aiPort";
import type { BrainContextSnapshot } from "./context";
import { BrainAbortError, throwIfAborted } from "./ports";
import type {
  BrainClock,
  ConversationTransport,
  ConversationTransportRequest,
  ConversationTransportResponse,
} from "./ports";

/* -------------------------------------------------------------------------- */
/* Contract types                                                             */
/* -------------------------------------------------------------------------- */

/** One turn of the composer conversation. `text` is plain text on both roles. */
export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
}

/** Closed set of reasons a conversational turn fell back to the local reply. */
export type ConversationFallbackReason =
  | "no-transport"
  | "timeout"
  | "transport"
  | "shape"
  | "aborted-shape";

export interface ConversationTurnResult {
  /** Sanitized reply text — safe to render as plain interpolated text. */
  reply: string;
  /** "ai" only when a transport reply passed reviewChatReply. */
  source: "ai" | "deterministic";
  /** Present iff source is "deterministic" AND a transport was configured or absent — see module doc. */
  fallbackReason?: ConversationFallbackReason;
  /** Wall time of the whole turn, measured on the injected clock. */
  latencyMs?: number;
}

export interface ConverseRequest {
  /** Full thread, oldest first — the transport gets multi-turn context. */
  messages: ConversationMessage[];
  /** Snapshot the host grounded this thread against (staleness echo). */
  contextSnapshotId?: string;
  /**
   * Host-generated correlation id (no customer data). Optional: absent, a
   * deterministic clock-derived id is used so the Brain stays randomness-free.
   */
  requestId?: string;
}

export interface ConverseDeps {
  /** Absent = deterministic-only mode; the lane must work with zero config. */
  transport?: ConversationTransport;
  clock: BrainClock;
  /** Per-attempt transport budget; default {@link DEFAULT_CHAT_ATTEMPT_TIMEOUT_MS}. */
  attemptTimeoutMs?: number;
  /** Context snapshot that grounds deterministicReply's examples (null-safe). */
  snapshot?: BrainContextSnapshot | null;
}

/** Suggested per-attempt budget — chat tolerates a longer wait than parsing. */
export const DEFAULT_CHAT_ATTEMPT_TIMEOUT_MS = 12000;

/* -------------------------------------------------------------------------- */
/* Sanitation (the candidateNormalization approach, applied to chat text)     */
/* -------------------------------------------------------------------------- */

/**
 * C0/C1 controls (except \n and \t), zero-width and joiner codepoints, bidi
 * marks, overrides and isolates, word joiners, BOM — the invisible-text attack
 * surface (mirrors candidateNormalization's HOSTILE_CODEPOINTS_RE).
 */
const HOSTILE_CODEPOINTS_RE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

function stripHostile(text: string): string {
  return text.replace(HOSTILE_CODEPOINTS_RE, "");
}

/** Hard cap on an accepted reply — chat text, never a payload. */
export const MAX_REPLY_CHARS = 4000;

/**
 * Hostile-input gate for a transport reply. The candidate is UNTRUSTED: it is
 * accepted only when it is a string that survives control/zero-width/bidi
 * stripping as non-empty; the accepted text is clamped to
 * {@link MAX_REPLY_CHARS} and runs of 3+ newlines are collapsed to a blank
 * line. Anything else is rejected with a short structural reason (safe to log,
 * never echoed to the author).
 */
export function reviewChatReply(
  candidate: unknown
): { accepted: true; reply: string } | { accepted: false; reason: string } {
  if (typeof candidate !== "string") return { accepted: false, reason: "not-a-string" };
  const clean = stripHostile(candidate).replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return { accepted: false, reason: "empty-reply" };
  return { accepted: true, reply: clean.slice(0, MAX_REPLY_CHARS) };
}

/* -------------------------------------------------------------------------- */
/* Utterance classification                                                   */
/* -------------------------------------------------------------------------- */

/** Case/whitespace-normalized comparison text (apostrophes unified). */
function normText(text: string): string {
  return stripHostile(text).toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

/** Whole-word presence of `word` in the normalized text. */
function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(text);
}

/**
 * Vocabulary evidence phrases, computed once from the shared vocabulary:
 * event keys + aliases, action labels + aliases (with `{param}` holes
 * removed), and condition-field labels. Multi-word phrases count as evidence
 * when ALL of their words appear (the generic event matcher's semantics —
 * "when a loan gets approved" still reads as LOAN APPROVED evidence);
 * single-word phrases require a whole-word hit.
 */
const VOCABULARY_EVIDENCE: string[][] = (() => {
  const phrases = new Set<string>();
  for (const event of EVENTS) {
    phrases.add(event.key.toLowerCase());
    for (const alias of event.aliases ?? []) phrases.add(alias.toLowerCase());
  }
  for (const action of ACTIONS) {
    phrases.add(action.label.toLowerCase());
    for (const alias of action.aliases ?? []) {
      phrases.add(alias.replace(/\{param\}/g, " ").toLowerCase());
    }
  }
  for (const field of Object.values(FIELDS)) phrases.add(field.label.toLowerCase());
  // Structural workflow phrasing that survives any vocabulary swap.
  for (const structural of ["workflow", "automation", "automate", "trigger", "escalate", "when a", "when the", "if the", "if a"]) {
    phrases.add(structural);
  }
  return [...phrases]
    .map((phrase) => phrase.split(/\s+/).filter((word) => word.length > 1))
    .filter((words) => words.length > 0);
})();

function hasVocabularyEvidence(text: string): boolean {
  return VOCABULARY_EVIDENCE.some((words) => words.every((word) => hasWord(text, word)));
}

/** Social openers — a match only classifies when the whole text stays short. */
const SOCIAL_OPENERS = [
  "hello", "hi", "hiya", "hey", "heya", "howdy", "yo", "sup", "what's up", "whats up",
  "good morning", "good afternoon", "good evening", "good day", "greetings",
  "thanks", "thank you", "thx", "ty", "ok", "okay", "cool", "nice", "great",
  "awesome", "perfect", "bye", "goodbye", "see you", "how are you", "how's it going",
];

/** Questions about the assistant/app — conversational at any length. */
const ASSISTANT_QUESTIONS = [
  "what can you do", "what do you do", "what can i do", "what can i ask",
  "who are you", "what are you", "what is this", "what's this", "whats this",
  "how does this work", "how do you work", "how do i use", "what is sweet",
  "who is sweet", "capabilities", "what can this do",
];

const QUESTION_OPENERS = ["what", "who", "how", "why", "where", "can", "could", "do", "does", "is", "are", "am"];

function isSocial(text: string): boolean {
  if (text.split(" ").length > 6) return false;
  return SOCIAL_OPENERS.some(
    (opener) => text === opener || text.startsWith(`${opener} `) || text.startsWith(`${opener},`) || text.startsWith(`${opener}!`)
  );
}

function isAssistantQuestion(text: string): boolean {
  if (hasWord(text, "help")) return true;
  return ASSISTANT_QUESTIONS.some((phrase) => text.includes(phrase));
}

/**
 * Which lane does a submission belong to? Deterministic, and biased so that
 * anything that even smells like a workflow keeps the parse lane's honest gap
 * reporting:
 *
 *  1. a drafted rule is a workflow, full stop;
 *  2. vocabulary evidence (events / actions / fields / structural "when …")
 *     is a workflow even when the parse failed — an imperfect instruction
 *     must keep today's red-notice honesty, never a chatty deflection;
 *  3. greetings/thanks/social and questions about the assistant or the app
 *     are conversational;
 *  4. default: short vocab-free text and plain questions are conversational;
 *     longer imperative text is treated as a workflow attempt.
 */
export function classifyUtterance(
  text: string,
  det: ParseResult | null
): "workflow" | "conversational" {
  if (det?.rule) return "workflow";
  const clean = normText(text);
  if (!clean) return "conversational";
  if (hasVocabularyEvidence(clean)) return "workflow";
  if (isSocial(clean) || isAssistantQuestion(clean)) return "conversational";
  if (clean.endsWith("?") || QUESTION_OPENERS.some((opener) => clean.startsWith(`${opener} `))) {
    return "conversational";
  }
  return clean.split(" ").length <= 12 ? "conversational" : "workflow";
}

/* -------------------------------------------------------------------------- */
/* Deterministic reply (the offline / mock floor)                             */
/* -------------------------------------------------------------------------- */

/**
 * Preferred example events, kept only when the live vocabulary still carries
 * them as VERIFIED — an example must never advertise a trigger the backend
 * cannot emit. The phrase is the natural-language form the parser's generic
 * matcher reads back to the same event.
 */
const EXAMPLE_EVENT_PHRASES: Array<{ key: string; phrase: string }> = [
  { key: "LOAN APPROVED", phrase: "a loan is approved" },
  { key: "DOCUMENT UPLOADED", phrase: "a document is uploaded" },
  { key: "SYSTEM ERROR", phrase: "a system error fires" },
];

function verifiedEvent(key: string): boolean {
  return EVENTS.some((event) => event.key === key && event.confidence === "verified");
}

function verifiedAction(key: string): boolean {
  return ACTIONS.some((action) => action.key === key && action.confidence === "verified");
}

/**
 * 2-3 concrete instructions composed ONLY from verified events/actions, with
 * names grounded in the snapshot's assignees when present (static fallback
 * otherwise). Deterministic: same vocabulary + snapshot, same examples.
 */
function exampleInstructions(snapshot: BrainContextSnapshot | null): string[] {
  const assignees =
    snapshot && Array.isArray(snapshot.assignees) && snapshot.assignees.length > 0
      ? snapshot.assignees
      : ASSIGNEES;
  const person = assignees[0] ?? "Wael";
  const team = assignees.find((name) => /team/i.test(name)) ?? person;
  const phrases = EXAMPLE_EVENT_PHRASES.filter(({ key }) => verifiedEvent(key)).map(
    ({ phrase }) => phrase
  );
  // Vocabulary drift guard: fall back to lowercased verified event labels,
  // skipping events an existing phrase already represents (word containment).
  for (const event of EVENTS) {
    if (phrases.length >= 3) break;
    if (event.confidence !== "verified") continue;
    const generic = event.label.toLowerCase();
    const words = generic.split(" ");
    if (!phrases.some((phrase) => words.every((word) => phrase.includes(word)))) {
      phrases.push(generic);
    }
  }
  const out: string[] = [];
  if (phrases[0] && verifiedAction("assign_user")) {
    out.push(`When ${phrases[0]}, assign to ${team}.`);
  }
  if (phrases[1] && verifiedAction("notify")) {
    out.push(`When ${phrases[1]}, notify ${person}.`);
  }
  if (phrases[2] && verifiedAction("add_tag")) {
    out.push(`When ${phrases[2]}, add tag "Priority".`);
  }
  return out.slice(0, 3);
}

function bulleted(examples: string[]): string {
  return examples.map((example) => `• “${example}”`).join("\n");
}

/** Verified vocabulary summary for the capability answer — labels only. */
function capabilitySummary(): { events: string[]; actions: string[] } {
  return {
    events: EVENTS.filter((event) => event.confidence === "verified")
      .slice(0, 3)
      .map((event) => event.label.toLowerCase()),
    actions: ACTIONS.filter((action) => action.confidence === "verified")
      .slice(0, 4)
      .map((action) => action.label),
  };
}

/**
 * The offline/mock fallback reply: friendly, honest, grounded. Three shapes —
 * greeting (introduce the assistant + verified examples), capability question
 * (summarize what the vocabulary can automate), everything else (admit the
 * text did not map to a workflow and offer the closest actionable phrasing).
 * It NEVER pretends to be online, and it never invents vocabulary.
 */
export function deterministicReply(
  text: string,
  snapshot: BrainContextSnapshot | null
): string {
  const clean = normText(text);
  const examples = exampleInstructions(snapshot);
  const exampleBlock = examples.length > 0 ? `\n\nFor example:\n${bulleted(examples)}` : "";
  if (isSocial(clean)) {
    return (
      "Hi — I’m Sweet, the workflow assistant. Describe an operation in plain language " +
      "and I’ll draft the workflow rule for you, with anything unclear called out for " +
      `your confirmation.${exampleBlock}`
    );
  }
  if (isAssistantQuestion(clean)) {
    const { events, actions } = capabilitySummary();
    return (
      "I turn plain-language instructions into workflow rules. I can react to platform " +
      `events like ${events.join(", ")}, and take actions like ${actions.join(", ")}. ` +
      "Nothing runs until you review it — incomplete details always come back as " +
      `questions, never guesses.${exampleBlock}`
    );
  }
  const closest = examples[0] ? `\n\nThe closest phrasing I can act on:\n${bulleted([examples[0]])}` : "";
  return (
    "I couldn’t map that to a workflow yet. I understand instructions shaped like " +
    `“when <event>, <action>” built from the workflow vocabulary.${closest}`
  );
}

/* -------------------------------------------------------------------------- */
/* Timeout racing (the orchestrator's callWithTimeout, chat-typed)            */
/* -------------------------------------------------------------------------- */

/**
 * Race one chat attempt against its deadline. setTimeout is the one scheduling
 * primitive the Brain may use; the external signal wins over everything and
 * surfaces as BrainAbortError; the timer is always cleared on settle.
 */
function callChatWithTimeout(
  transport: ConversationTransport,
  request: ConversationTransportRequest,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  where: string
): Promise<ConversationTransportResponse> {
  throwIfAborted(signal, where);
  return new Promise<ConversationTransportResponse>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => settle(() => reject(new BrainAbortError(where)));
    const timer = setTimeout(() => settle(() => reject(new TransportTimeoutError(where))), timeoutMs);
    signal?.addEventListener("abort", onAbort);
    Promise.resolve()
      .then(() => transport.chat(request, signal))
      .then(
        (response) => settle(() => resolve(response)),
        (error) => settle(() => reject(error))
      );
  });
}

/* -------------------------------------------------------------------------- */
/* The conversational turn                                                    */
/* -------------------------------------------------------------------------- */

/** Newest user message — what the deterministic fallback answers. */
function lastUserText(messages: ConversationMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].text;
  }
  return "";
}

/**
 * One conversational turn, hybridParse-style. No transport → deterministic
 * fallback ("no-transport"). With a transport → one attempt raced against
 * `attemptTimeoutMs`; the reply is UNTRUSTED and must pass reviewChatReply;
 * every failure class falls back onto deterministicReply with the honest
 * reason from the module-doc closed set. An external abort throws
 * BrainAbortError and never yields a result. Latency is measured on the
 * injected clock only.
 */
export async function converse(
  request: ConverseRequest,
  deps: ConverseDeps,
  signal?: AbortSignal
): Promise<ConversationTurnResult> {
  throwIfAborted(signal, "converse");
  const startedAt = deps.clock.now();
  const snapshot = deps.snapshot ?? null;
  const lastUser = lastUserText(request.messages);
  const fallback = (reason: ConversationFallbackReason): ConversationTurnResult => ({
    reply: deterministicReply(lastUser, snapshot),
    source: "deterministic",
    fallbackReason: reason,
    latencyMs: deps.clock.now() - startedAt,
  });

  const transport = deps.transport;
  if (!transport) return fallback("no-transport");

  const wire: ConversationTransportRequest = {
    messages: request.messages.map((message) => ({ role: message.role, text: message.text })),
    requestId:
      request.requestId ?? `chat-${Math.max(0, Math.floor(startedAt)).toString(36)}`,
  };
  if (request.contextSnapshotId !== undefined) wire.contextSnapshotId = request.contextSnapshotId;

  let response: ConversationTransportResponse;
  try {
    response = await callChatWithTimeout(
      transport,
      wire,
      deps.attemptTimeoutMs ?? DEFAULT_CHAT_ATTEMPT_TIMEOUT_MS,
      signal,
      "chat"
    );
  } catch (error) {
    // A caller abort propagates; an abort-shaped error the caller never asked
    // for is transport misbehavior and falls back (module doc: "aborted-shape").
    throwIfAborted(signal, "chat");
    const errorClass = classifyTransportError(error);
    if (errorClass === "aborted") return fallback("aborted-shape");
    return fallback(errorClass === "timeout" ? "timeout" : "transport");
  }

  const candidate =
    typeof response === "object" && response !== null && "reply" in response
      ? (response as ConversationTransportResponse).reply
      : undefined;
  const verdict = reviewChatReply(candidate);
  if (!verdict.accepted) return fallback("shape");
  return { reply: verdict.reply, source: "ai", latencyMs: deps.clock.now() - startedAt };
}
