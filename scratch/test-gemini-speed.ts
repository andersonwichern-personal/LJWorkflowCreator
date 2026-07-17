import {
  ACTIONS,
  ASSIGNEES,
  EVENTS,
  FIELDS,
  OPERATORS,
} from "../packages/rule-core/src/vocabulary";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set.");
  process.exit(1);
}

const models = [
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview"
];

const testPrompt = "When a loan is approved, assign to Wael";

async function runBenchmark(model: string, runs = 3) {
  let totalTime = 0;
  let successCount = 0;
  for (let i = 1; i <= runs; i++) {
    const start = Date.now();
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: testPrompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1
          }
        })
      });
      const duration = Date.now() - start;
      if (res.ok) {
        successCount++;
        totalTime += duration;
        console.log(`  Run ${i}: ${duration}ms (HTTP 200)`);
      } else {
        console.log(`  Run ${i}: FAILED (${res.status}: ${await res.text()})`);
      }
    } catch (e) {
      console.log(`  Run ${i}: ERROR (${e instanceof Error ? e.message : e})`);
    }
  }
  if (successCount > 0) {
    console.log(`⭐ Model "${model}" average successful latency: ${Math.round(totalTime / successCount)}ms (${successCount}/${runs} successful)\n`);
  } else {
    console.log(`❌ Model "${model}" failed all runs.\n`);
  }
}

async function run() {
  console.log("Starting model latency benchmark (3 runs per model)...\n");
  for (const m of models) {
    console.log(`Testing ${m}:`);
    await runBenchmark(m);
  }
}

run();
