# Prompt: AI Console & Visual Hierarchy Redesign (ChatGPT Style)

**Instructions for Claude**: Read this file to execute the UI updates and design polish described below.

---

### Redesign Goals

We want to make the AI entry point a premium focal element that mimics modern AI engines (like the ChatGPT input console) while anchoring the visual hierarchy with the Workflow Title Bar at the very top. Additionally, we want to align the styling closer to the Landjourney admin portal's professional color, font, and panel designs.

Please implement these visual refinements:

#### 1. Visual Hierarchy Rearrangement
Adjust the layout structure in [WorkflowCreator.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/components/WorkflowCreator.tsx) to follow this vertical flow in the main canvas:
1.  **Top**: **Workflow Title Bar** (The header containing the workflow Name input, Description input, Enabled toggle, and Save/Delete/New action buttons). This anchors what rule you are editing.
2.  **Middle**: **Focal AI Chat Console** (ChatGPT style, detailed below).
3.  **Bottom**: **Structured Token sentence** (`WHEN/IF/THEN` interactive pills) followed by the Simulation/Test panel.

#### 2. ChatGPT-Style AI Console (`components/ChatBox.tsx`)
Redesign the chat container to look like a premium, focal AI engine:
*   **Greeting**: Above the input bar, render a clean, centered title: 
    *   `How can I help, Anderson?` in a comfortable, medium-weight font (e.g. `text-2xl` or `text-3xl` in dark slate/white).
*   **Focal Input Pill**:
    *   Style the input bar as a wide, fully rounded pill (`rounded-full`).
    *   Include a `+` icon on the left inside the input.
    *   Include placeholder text `"Ask ChatGPT..."` or `"Describe your rule in plain English..."`.
    *   Include a microphone icon and a circular wave/submit button on the right inside the input (matching the ChatGPT design).
    *   Ensure large padding (`py-4.5 px-6`) and clean, soft focus borders.
*   **Suggestions**: Position a few clean, subtle template suggestions underneath the input pill, styled as minimal pill chips.

#### 3. Landjourney Design Alignment (Polishing `app/globals.css` and UI layouts)
Make the interface feel hand-crafted and integrated, avoiding typical "AI-builder" tropes:
*   **Neutral Colors**: Use slate/gray tones for panel backgrounds (`bg-slate-50` light, `bg-slate-900` dark) and clean, crisp border lines (`border-slate-200` light, `border-slate-800` dark). Avoid large, colorful gradients.
*   **Typography**: Set the font to a clean, crisp sans-serif family (Inter/Outfit style) with precise weights.
*   **Panel Contrast**: Simplify the side navigation list and card wrappers to use flat, modern panels with high contrast and sharp readability.

---

### Step-by-Step Instructions

1.  Reorder the layout hierarchy inside [WorkflowCreator.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/components/WorkflowCreator.tsx) so the Workflow Title Bar is at the top, above the ChatBox.
2.  Redesign [ChatBox.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/components/ChatBox.tsx) to match the centered ChatGPT input interface.
3.  Polish the global styles in [app/globals.css](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/app/globals.css) and clean up card borders/padding.
4.  Run `npm run build` and `npm run lint` to verify compilation.
5.  Report back when the changes are ready to compile and merge!
