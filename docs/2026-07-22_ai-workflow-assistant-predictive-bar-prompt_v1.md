# Prompt for Claude Code: AI Workflow Assistant & Predictive Autocomplete Bar

**Date:** 2026-07-22  
**Target Execution Agent:** Claude Code (Hands-on Developer / CLI executor)  
**Architect & Overseer:** Gemini (Antigravity)  
**Target Repository:** `/Users/andersonwichern/Claude Files/Sweet Coding Work`  
**Prompt File:** `docs/2026-07-22_ai-workflow-assistant-predictive-bar-prompt_v1.md`  

---

## 1. Goal & Vision

Elevate the natural-language workflow composer from a plain deterministic parser engine into a **fully aware, specialized AI Assistant** dedicated to drafting, refining, and validating operational workflows.

Specifically:
1. **Predictive Ghost Text Sub-Bar**: Introduce an inline predictive autocomplete bar underneath the composer's typing input that predicts what the user is going to say as they type (similar to Google Search predictive autocomplete / ghost text suggestions based on active vocabulary, triggers, and fields).
2. **Remove Demo Scaffolding**: Eliminate the "Try a demo" section/buttons from the composer UI to present a clean, executive, production-ready AI Assistant interface.
3. **AI Assistant Awareness**: Position the composer visual state around an active, intelligent assistant experience with live feedback and token-aware suggestion resolution.

---

## 2. Copyable Prompt for Claude Code

Copy and paste the following block directly into Claude Code:

```text
Please execute the following UI and feature upgrades to transform the Workflow Composer into a specialized AI Assistant:

1. PREDICTIVE GHOST TEXT AUTOCOMPLETE SUB-BAR (`workflow-composer.page.ts` / `chat-draft.ts`):
   - Add a predictive suggestion sub-bar directly beneath the main natural language typing textarea/input.
   - As the user types, inspect the partial instruction against the live vocabulary (events, trigger fields, operators, and common operational phrases).
   - Render inline ghost text or a sleek predictive autocomplete bar showing the predicted continuation of their phrase (e.g., typing "When a loan is approved..." predicts "...assign to Underwriting Team and notify Sarah").
   - Pressing `Tab` or `Right Arrow` (or clicking the prediction chip) accepts the ghost text prediction and appends it to the active input.

2. REMOVE "TRY A DEMO" SCAFFOLDING:
   - Remove the `demoWorkflows` array, demo cards, and "Try a demo" buttons from `workflow-composer.page.ts`.
   - Clean up the hero/composer layout so the focus is entirely on the main natural-language prompt input and the predictive AI assistant.

3. SPECIALIZED AI ASSISTANT POSITIONING:
   - Update composer headers, placeholders, and status labels to present the engine as a specialized, domain-aware AI Workflow Assistant.
   - Retain all purity gates (`@sweet/rule-core`) and real-AI gateway integration (`DraftEngineService`), ensuring predicted suggestions feel instant and responsive.

4. VERIFICATION:
   - Run `npm test` to verify all 370 fixpoint and UX contract assertions pass.
   - Run `npm run build` to confirm clean Angular compilation.
```
