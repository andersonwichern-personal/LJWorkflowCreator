/**
 * assert-brain-conversation — pins the conversational lane of the Workflow
 * Brain (conversation.ts + the ConversationTransport port).
 *
 *  - classifyUtterance truth table: social/help/short-question text is
 *    conversational; a drafted rule, ANY vocabulary evidence (including the
 *    generic-event reading "when a loan gets approved"), or long imperative
 *    text stays on the parse lane so honest gap reporting is never deflected;
 *  - reviewChatReply: MODEL OUTPUT IS UNTRUSTED — non-strings rejected,
 *    control/zero-width/bidi stripped, newline runs collapsed, hard clamp,
 *    empty-after-sanitation rejected;
 *  - deterministicReply: pure, grounded ONLY in verified vocabulary (never an
 *    unconfirmed event/action), examples grounded in the snapshot's assignees;
 *  - converse(): no transport → "no-transport"; transport throw → "transport";
 *    malformed reply → "shape"; real timeout race (10 ms budget vs 50 ms
 *    transport, no wall-clock assertions) → "timeout"; an abort-SHAPED throw
 *    while the caller's signal is NOT aborted → "aborted-shape"; a real caller
 *    abort THROWS BrainAbortError (M1/M3 doctrine — never a stale result);
 *    latency comes from the injected clock only;
 *  - determinism: same inputs ⇒ deep-equal results.
 *
 * Everything is local: transports are stubs, the clock is injected and fake.
 * No network, no live models.
 *
 * Run: npx tsx core-tests/assert-brain-conversation.ts
 */
import {
  classifyUtterance,
  converse,
  DEFAULT_CHAT_ATTEMPT_TIMEOUT_MS,
  deterministicReply,
  MAX_REPLY_CHARS,
  reviewChatReply,
  type ConversationMessage,
  type ConversationTurnResult,
} from "../packages/workflow-brain/src/conversation";
import { BrainAbortError } from "../packages/workflow-brain/src/ports";
import type {
  ConversationTransport,
  ConversationTransportRequest,
} from "../packages/workflow-brain/src/ports";
import type { BrainContextSnapshot } from "../packages/workflow-brain/src/context";
import { parseInstruction, type ParseResult } from "../packages/rule-core/src/nlParser";
import { ACTIONS, EVENTS } from "../packages/rule-core/src/vocabulary";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

class FakeClock {
  t = 1000;
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

function makeSnapshot(over: Partial<BrainContextSnapshot> = {}): BrainContextSnapshot {
  return {
    snapshotId: "ctx-conv-1",
    profile: "standalone-demo",
    identity: { tenantKey: "tenant-a" },
    vocabularyHash: "v-abc123",
    instanceOptions: {},
    instanceRegistry: {},
    assignees: ["Zainab", "Ops Team"],
    entities: [],
    relatedWorkflows: [],
    allowedActionKeys: ["assign_user"],
    sources: [],
    budget: { maxBytes: 4096, usedBytes: 0, truncated: [] },
    privacyCeiling: "public-vocabulary",
    ...over,
  };
}

const user = (text: string): ConversationMessage => ({ role: "user", text });

/** Deterministic parse of the same text — what the composer hands the classifier. */
const det = (text: string): ParseResult => parseInstruction(text);

/** A ParseResult that carries a drafted rule (contents irrelevant to the classifier). */
function withRule(): ParseResult {
  return {
    rule: { marker: "drafted" } as unknown as ParseResult["rule"],
    notes: [],
    unresolved: [],
    uncovered: [],
    ambiguities: [],
  };
}

/** Transport whose behavior is scripted per call; records every wire request. */
function stubTransport(behavior: (request: ConversationTransportRequest) => Promise<unknown>): {
  calls: ConversationTransportRequest[];
  transport: ConversationTransport;
} {
  const calls: ConversationTransportRequest[] = [];
  const transport: ConversationTransport = {
    chat(request) {
      calls.push(JSON.parse(JSON.stringify(request)));
      return behavior(request) as ReturnType<ConversationTransport["chat"]>;
    },
  };
  return { calls, transport };
}

/* -------------------------------------------------------------------------- */
/* Scenarios                                                                  */
/* -------------------------------------------------------------------------- */

async function main() {
  /* C — classifyUtterance truth table */
  {
    t("C1 hello → conversational", classifyUtterance("hello", det("hello")) === "conversational");
    t(
      "C2 hi there → conversational",
      classifyUtterance("hi there", det("hi there")) === "conversational"
    );
    t("C3 thanks! → conversational", classifyUtterance("thanks!", det("thanks!")) === "conversational");
    t(
      "C4 what can you do? → conversational",
      classifyUtterance("what can you do?", det("what can you do?")) === "conversational"
    );
    t(
      "C5 short vocab-free question → conversational",
      classifyUtterance("do you enjoy your job?", null) === "conversational"
    );
    t(
      "C6 short vocab-free statement → conversational",
      classifyUtterance("i had a nice weekend", null) === "conversational"
    );
    t(
      "C7 empty / hostile-only text → conversational",
      classifyUtterance("\u200B\u202E \u0007", null) === "conversational"
    );

    const full = "When a loan is approved, assign to Wael";
    const fullDet = det(full);
    t("C8 precondition: full instruction drafts a rule", fullDet.rule !== null);
    t("C8b parsed rule → workflow", classifyUtterance(full, fullDet) === "workflow");
    t(
      "C9 a drafted rule wins over social text",
      classifyUtterance("hello", withRule()) === "workflow"
    );

    const gappy = "when a loan is approved do the special thing";
    t(
      "C10 vocab evidence with parse gap → workflow (honest gap reporting preserved)",
      classifyUtterance(gappy, det(gappy)) === "workflow" &&
        classifyUtterance(gappy, null) === "workflow"
    );
    t(
      "C11 generic-event phrasing 'when a loan gets approved' → workflow",
      classifyUtterance("when a loan gets approved", null) === "workflow"
    );
    t(
      "C12 long vocab-free imperative → workflow attempt",
      classifyUtterance(
        "please make sure the intern remembers to water the office plants every single morning without fail",
        null
      ) === "workflow"
    );
  }

  /* R — reviewChatReply: the model's text is hostile input */
  {
    for (const [label, candidate] of [
      ["number", 42],
      ["null", null],
      ["undefined", undefined],
      ["object", { reply: "hi" }],
      ["array", ["hi"]],
    ] as const) {
      const verdict = reviewChatReply(candidate);
      t(`R1 non-string rejected (${label})`, verdict.accepted === false && verdict.reason === "not-a-string");
    }
    const stripped = reviewChatReply("hel\u0000lo\u200B world\u202E\uFEFF");
    t(
      "R2 control/zero-width/bidi stripped",
      stripped.accepted === true && stripped.reply === "hello world",
      JSON.stringify(stripped)
    );
    const empty = reviewChatReply("\u200B\u0007 \uFEFF\t\n");
    t("R3 empty-after-sanitation rejected", empty.accepted === false && empty.reason === "empty-reply");
    const long = reviewChatReply("x".repeat(MAX_REPLY_CHARS * 3));
    t(
      "R4 clamped to MAX_REPLY_CHARS exactly",
      long.accepted === true && long.reply.length === MAX_REPLY_CHARS
    );
    const collapsed = reviewChatReply("a\n\n\n\n\nb\n\nc");
    t(
      "R5 3+ newline runs collapse to a blank line",
      collapsed.accepted === true && collapsed.reply === "a\n\nb\n\nc",
      JSON.stringify(collapsed)
    );
  }

  /* G — deterministicReply grounding */
  {
    const snapshot = makeSnapshot();
    const greeting = deterministicReply("hello", snapshot);
    t("G1 greeting introduces the assistant", greeting.includes("Sweet"));
    t(
      "G2 greeting examples grounded in snapshot assignees",
      greeting.includes("assign to Ops Team") && greeting.includes("Zainab"),
      greeting
    );
    const nullSnap = deterministicReply("hello", null);
    t(
      "G3 null snapshot falls back to static vocabulary assignees",
      nullSnap.includes("assign to Underwriting Team") && nullSnap.includes("Wael"),
      nullSnap
    );
    const unverifiedEventLabels = EVENTS.filter((e) => e.confidence !== "verified").map((e) =>
      e.label.toLowerCase()
    );
    const unverifiedActionLabels = ACTIONS.filter((a) => a.confidence !== "verified").map((a) =>
      a.label.toLowerCase()
    );
    const capability = deterministicReply("what can you do?", snapshot);
    const advertised = [greeting, nullSnap, capability].join("\n").toLowerCase();
    t(
      "G4 no unverified event ever advertised (e.g. document uploaded)",
      unverifiedEventLabels.length > 0 &&
        unverifiedEventLabels.every((label) => !advertised.includes(label)) &&
        !advertised.includes("document is uploaded")
    );
    t(
      "G5 no unverified action ever advertised",
      unverifiedActionLabels.length > 0 &&
        unverifiedActionLabels.every((label) => !advertised.includes(label))
    );
    t(
      "G6 capability answer names verified events and actions",
      capability.includes("loan approved") && capability.includes("assign to"),
      capability
    );
    const unknown = deterministicReply("purple monkey dishwasher", snapshot);
    t(
      "G7 unknown text admits the miss and offers the closest actionable phrasing",
      unknown.includes("map that to a workflow") && unknown.includes("assign to Ops Team"),
      unknown
    );
    t(
      "G8 deterministicReply is deterministic",
      deterministicReply("hello", snapshot) === greeting &&
        deterministicReply("what can you do?", snapshot) === capability
    );
  }

  /* V — converse: fallback lanes and the accepted path */
  {
    const clock = new FakeClock();
    const snapshot = makeSnapshot();
    const res = await converse({ messages: [user("hello")] }, { clock, snapshot });
    t(
      "V1 no transport → deterministic, reason no-transport",
      res.source === "deterministic" && res.fallbackReason === "no-transport" && res.reply.length > 0
    );
    t("V2 no-transport latency measured on the injected clock (0)", res.latencyMs === 0);
    t(
      "V3 fallback answers the LAST user message (capability, not greeting)",
      (
        await converse(
          { messages: [user("hello"), { role: "assistant", text: "hi" }, user("what can you do?")] },
          { clock, snapshot }
        )
      ).reply.includes("loan approved")
    );

    const throwing = stubTransport(async () => {
      clock.advance(250);
      throw new Error("boom");
    });
    const res2 = await converse(
      { messages: [user("hello")] },
      { clock, transport: throwing.transport, snapshot }
    );
    t(
      "V4 transport throw → deterministic, reason transport",
      res2.source === "deterministic" && res2.fallbackReason === "transport"
    );
    t("V5 fallback latency comes from the injected clock", res2.latencyMs === 250);

    for (const [label, reply] of [
      ["number reply", 42],
      ["missing reply field", undefined],
      ["zero-width-only reply", "\u200B\u202E"],
    ] as const) {
      const malformed = stubTransport(async () =>
        label === "missing reply field" ? {} : { reply }
      );
      const res3 = await converse(
        { messages: [user("hello")] },
        { clock: new FakeClock(), transport: malformed.transport, snapshot }
      );
      t(
        `V6 malformed transport reply → shape (${label})`,
        res3.source === "deterministic" && res3.fallbackReason === "shape"
      );
    }

    const goodClock = new FakeClock();
    const good = stubTransport(async () => {
      goodClock.advance(300);
      return { reply: "\u200BHi!\n\n\n\nI help you draft workflow rules.", meta: { model: "test" } };
    });
    const res4 = await converse(
      {
        messages: [user("hello")],
        contextSnapshotId: snapshot.snapshotId,
        requestId: "req-chat-7",
      },
      { clock: goodClock, transport: good.transport, snapshot }
    );
    t(
      "V7 accepted reply → source ai, sanitized before it is returned",
      res4.source === "ai" && res4.reply === "Hi!\n\nI help you draft workflow rules."
    );
    t("V8 no fallbackReason on the ai path", res4.fallbackReason === undefined);
    t("V9 ai-path latency comes from the injected clock", res4.latencyMs === 300);
    t(
      "V10 wire request carries messages + caller requestId + snapshot id",
      good.calls.length === 1 &&
        good.calls[0].messages.length === 1 &&
        good.calls[0].messages[0].text === "hello" &&
        good.calls[0].requestId === "req-chat-7" &&
        good.calls[0].contextSnapshotId === "ctx-conv-1"
    );

    const idClock = new FakeClock(); // starts at 1000 → base36 "rs"
    const echo = stubTransport(async () => ({ reply: "ok" }));
    await converse({ messages: [user("hello")] }, { clock: idClock, transport: echo.transport });
    t(
      "V11 absent requestId → deterministic clock-derived id, no snapshot echo",
      echo.calls[0].requestId === "chat-rs" && !("contextSnapshotId" in echo.calls[0]),
      JSON.stringify(echo.calls[0].requestId)
    );
  }

  /* T — timeout race: 10 ms budget vs 50 ms transport (real timers, no
   * wall-clock assertions — only the classified reason is pinned) */
  {
    const slow = stubTransport(async () => {
      await delay(50);
      return { reply: "too late" };
    });
    const res = await converse(
      { messages: [user("hello")] },
      { clock: new FakeClock(), transport: slow.transport, attemptTimeoutMs: 10 }
    );
    t(
      "T1 slow transport → deterministic, reason timeout",
      res.source === "deterministic" && res.fallbackReason === "timeout"
    );
    t("T2 default attempt budget exported for hosts", DEFAULT_CHAT_ATTEMPT_TIMEOUT_MS === 12000);
  }

  /* A — abort semantics: caller aborts throw; abort-shaped throws fall back */
  {
    for (const [label, thrown] of [
      ["BrainAbortError instance", new BrainAbortError("self-cancel")],
      ["abort-shaped object", { aborted: true }],
    ] as const) {
      const selfCancelling = stubTransport(async () => {
        throw thrown;
      });
      const res = await converse(
        { messages: [user("hello")] },
        { clock: new FakeClock(), transport: selfCancelling.transport }
      );
      t(
        `A1 abort-shaped throw without a caller abort → aborted-shape (${label})`,
        res.source === "deterministic" && res.fallbackReason === "aborted-shape"
      );
    }

    const controller = new AbortController();
    const hanging = stubTransport(() => new Promise(() => {}));
    const pending = converse(
      { messages: [user("hello")] },
      { clock: new FakeClock(), transport: hanging.transport },
      controller.signal
    );
    controller.abort();
    let thrown: unknown = null;
    let resolved: ConversationTurnResult | null = null;
    try {
      resolved = await pending;
    } catch (e) {
      thrown = e;
    }
    t(
      "A2 caller abort mid-transport THROWS BrainAbortError (never a stale reply)",
      resolved === null && thrown instanceof BrainAbortError && (thrown as Error).name === "BrainAbortError"
    );

    const preAborted = new AbortController();
    preAborted.abort();
    let threwEarly = false;
    try {
      await converse({ messages: [user("hello")] }, { clock: new FakeClock() }, preAborted.signal);
    } catch (e) {
      threwEarly = e instanceof BrainAbortError;
    }
    t("A3 already-aborted signal throws before any work", threwEarly);
  }

  /* D — determinism: same inputs, deep-equal results */
  {
    const snapshot = makeSnapshot();
    const run = () => converse({ messages: [user("hello")] }, { clock: new FakeClock(), snapshot });
    const [a, b] = [await run(), await run()];
    t("D1 deterministic fallback is stable across runs", JSON.stringify(a) === JSON.stringify(b));
    t(
      "D2 classification is stable across runs",
      classifyUtterance("hello", det("hello")) === classifyUtterance("hello", det("hello"))
    );
  }

  if (failures > 0) {
    console.error(`\n✗ assert-brain-conversation: ${failures} failure(s).`);
    process.exit(1);
  }
  console.log(
    "\n✓ conversational lane honors the mandate: parse-lane honesty untouched, hostile replies gated, fail-closed fallbacks, aborts throw."
  );
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exit(1);
});
