# Prompt: AI Engine Upgrade — Gemini LLM Integration

## Task Description
Implement the **AI Engine Upgrade** to connect the natural language input console to the Google Gemini API. This replaces the brittle, regex-based parser with context-aware, flexible LLM parsing while gracefully falling back to the local deterministic regex parser if no API key is configured.

You MUST perform this work on a new git branch: `feature/ai-engine-upgrade`.

---

## 1. Backend Route `POST /api/workflows/parse-ai`
Create a new API route at `app/api/workflows/parse-ai/route.ts`:
*   Check if `process.env.GEMINI_API_KEY` is present.
    *   *If absent*: Import `parseInstruction` from `lib/nlParser.ts` and delegate the parse execution directly. Return `{ rule, notes, suggestions: [], unresolved, uncovered, ambiguities, engine: "heuristic" }`.
    *   *If present*: Execute an HTTP POST fetch calling the Gemini API directly (no new npm package dependencies allowed):
        ```ts
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        ```
*   **Dynamic Context Generation**:
    *   Construct the Gemini system instructions dynamically by loading current vocabulary properties from `lib/vocabulary.ts` (trigger events, operators, teams).
    *   Load live proxies dynamically (using `toLiveFields()` and active template stages from `lib/platform.ts` and active users) to embed current template stage names, live form fields, and assignee options directly into the LLM system context. This guarantees that when a tenant adds new fields or staff records, the LLM parses them instantly without hard-coded mapping rot.
*   **Personable & Smart Conversational Guidance**:
    *   Instruct the model to act as a friendly, expert credit policy coach.
    *   Return a structured JSON block matching:
        ```json
        {
          "rule": WorkflowRule | null,
          "notes": string[],
          "suggestions": string[],
          "unresolved": UnresolvedSlot[],
          "uncovered": string[]
        }
        ```
    *   `notes` array should contain warm, personable logs detailing decisions made (e.g. *"I enabled shadow mode so you can safely observe how this matches requests first. I also mapped standard review to your Underwriting Review stage."*).
    *   `suggestions` array must offer up to 3 personable next-step recommendations to refine their prompt based on active vocabulary (e.g. *"Did you mean to notify Wael (Credit Officer)?"*, *"Would you like to auto-tag the request as 'high-risk'?"*).
    *   Request JSON structured output by setting the request parameter `responseMimeType: "application/json"` in the Gemini API payload.
    *   Return the parsed payload along with `engine: "gemini"`.

---

## 2. Frontend Upgrades (`components/ChatBox.tsx`)
*   **API Calling**: Update the chat submission logic. Instead of calling `parseInstruction` client-side, make a `POST` fetch to `/api/workflows/parse-ai` carrying the text input and optional `forceEvent` choice.
*   **Conversational Refinements UI**:
    *   Render the personable `suggestions` array returned by the API as a horizontal set of clickable pill chips above the text input box.
    *   Clicking a suggestion chip appends the suggested refinement text to the input and re-triggers parsing instantly.
*   **Parser Engine Indicator**:
    *   Render a small badge inside the input field or directly underneath the chat text pill:
        *   🟢 **AI Engine: Gemini LLM** (when `engine === "gemini"`)
        *   🟡 **AI Engine: Heuristic Fallback** (when `engine === "heuristic"`, displaying a tooltip: *"Add GEMINI_API_KEY to your .env.local file to enable smart LLM parsing."* on hover).

---

## 3. Verification & Safety Checks
*   Ensure that if the Gemini API fails (network timeout or rate limit), the backend catches the error and degrades gracefully to the local heuristic parser (logging the error but returning a valid response under the `"heuristic"` engine tag).
*   Add a test key to `.env.local` and type multiple natural language configurations to test translation accuracy.
*   Verify builds and linters compile successfully:
    ```bash
    git checkout -b feature/ai-engine-upgrade
    npm run test
    npm run build && npm run lint
    ```
