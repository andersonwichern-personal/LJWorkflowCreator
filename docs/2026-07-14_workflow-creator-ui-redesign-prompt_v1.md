# Prompt: Workflow Creator UI Redesign (AI-First & Sleek Landjourney Style)

**Instructions for Claude**: Read this file to execute the visual redesign and hierarchy changes described below.

---

### Redesign Goals

We want to align the Workflow Creator UI closer to the clean, production-grade Landjourney design system, make the AI assistant the central focal point, and declutter the interface by stripping out extra descriptive subtext.

Please implement these visual refinements:

#### 1. AI-First Layout & Prominent Chat Box (`components/ChatBox.tsx`)
*   **Move to Top**: Relocate the AI Chat Box to the very top of the main builder canvas inside [WorkflowCreator.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/components/WorkflowCreator.tsx). It must be the first thing a user sees.
*   **Scale Up**: Make the chat input bar significantly larger:
    *   Increase padding (e.g. `py-4 px-6` or `py-5 px-7`).
    *   Increase text size (e.g. `text-lg` or `text-xl`).
    *   Style it as a prominent Command Center/Search Console bar with a premium border and active shadow.
*   **Sleek Instructions**: Keep the quick-prompt suggestion cards under it, but style them as small, minimal, clean pills without paragraph text.

#### 2. Get Rid of Subtext & Clutter (Decluttering)
Remove auxiliary descriptions, subheaders, and help labels from the pages and components:
*   **Header Subtext**: Remove subtext paragraphs from headings (e.g. *"Automate loan origination — in plain English"*, *"Test against representative data — the real event bus runs in the backend"*).
*   **Card Descriptions**: Strip out any placeholder descriptions or verbose text from cards. The UI should rely on clean icons and numbers.
*   **Popovers & Pickers**: Remove field hints and help blurbs (like `hint` or `blurb` text blocks) from [TokenPicker.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/components/TokenPicker.tsx) if they render as descriptive text paragraphs. Keep the picker options extremely compact and clean.

#### 3. Match Landjourney UI Style (`app/globals.css`)
*   **Borders & Margins**: Use thin, clean borders (`border-gray-200` or `border-slate-800` depending on theme) and generous, modern spacing.
*   **Premium Theme Tokens**: Standardize colors to look like a production SaaS admin panel (sleek slates, deep indigos, and soft borders).
*   **Card Backdrops**: Use clean, semi-translucent panels with subtle shadows instead of heavy gradients or colorful borders.

---

### Step-by-Step Instructions

1.  Redesign the page hierarchy in [WorkflowCreator.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/components/WorkflowCreator.tsx) to render the AI Chat Box first.
2.  Polish the styling in [ChatBox.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/components/ChatBox.tsx), [TokenPicker.tsx](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/components/TokenPicker.tsx), and [app/globals.css](file:///Users/andersonwichern/Claude%20Files/Sweet%20Coding%20Work/app/globals.css).
3.  Test compilation by running `npm run build` and `npm run lint`.
4.  Report back when the changes are ready to compile and merge!
