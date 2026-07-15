const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set.");
  process.exit(1);
}

const model = "gemini-3.1-flash-lite";
const testPrompt = "When a loan is approved, if amount is greater than 50000, assign to Wael";

async function testAccuracy() {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({
                  instruction: testPrompt,
                  forceEvent: null,
                  activeVocabulary: {
                    events: [{ key: "LOAN APPROVED", label: "Loan Approved" }],
                    fields: [{ key: "loan_amount", label: "Loan Amount", kind: "numeric" }],
                    actions: [{ key: "assign_user", label: "Assign User", paramKind: "assignee" }],
                    users: [{ id: "wael_id", label: "Wael" }]
                  }
                })
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1
        }
      })
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      console.log("✅ Response:\n", text);
    } else {
      console.error("❌ Failed:", await res.text());
    }
  } catch (e) {
    console.error("Error:", e);
  }
}

testAccuracy();
