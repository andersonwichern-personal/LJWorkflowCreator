/**
 * Sweet UX contract: deterministic parser-visual states plus the accessibility
 * and safety seams that a browserless test can reliably protect.
 *
 * Run: npx tsx core-tests/assert-sweet-ux.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SWEET_SPIRAL_STATUS,
  deriveSweetSpiralState,
  type SweetSpiralContext,
  type SweetSpiralState,
} from '../src/app/features/workflows/ui/sweet-spiral.state';

let failures = 0;
let assertions = 0;

function t(name: string, condition: boolean, detail?: string) {
  assertions++;
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${!condition && detail ? ` — ${detail}` : ''}`);
}

const BASE: SweetSpiralContext = {
  phase: 'idle',
  focused: false,
  hasText: false,
  hasRule: false,
  hasGaps: false,
  hasQuestions: false,
};

function state(
  name: string,
  expected: SweetSpiralState,
  context: Partial<SweetSpiralContext> = {}
) {
  const actual = deriveSweetSpiralState({ ...BASE, ...context });
  t(name, actual === expected, `expected ${expected}, got ${actual}`);
}

/* ---- Deterministic state matrix ----------------------------------------- */

state('idle: untouched and unfocused', 'idle');
state('focused: empty composer has focus', 'focused', { focused: true });
state('typing: text outranks focus', 'typing', { focused: true, hasText: true });
state('submitted: receipt phase outranks draft content', 'submitted', {
  phase: 'submitted',
  focused: true,
  hasText: true,
  hasRule: true,
  hasGaps: true,
  hasQuestions: true,
});
state('parsing: active parse outranks any provisional rule', 'parsing', {
  phase: 'parsing',
  focused: true,
  hasText: true,
  hasRule: true,
  hasGaps: true,
  hasQuestions: true,
});
state('clarification: questions outrank the generic partial state', 'clarification', {
  hasText: true,
  hasRule: true,
  hasGaps: true,
  hasQuestions: true,
});
state('partial: a rule with unresolved gaps cannot look successful', 'partial', {
  focused: true,
  hasText: true,
  hasRule: true,
  hasGaps: true,
});
state('understood: a complete rule outranks typing and focus', 'understood', {
  focused: true,
  hasText: true,
  hasRule: true,
});
state('parser error: parse failure outranks provisional success', 'parser-error', {
  phase: 'parser-error',
  focused: true,
  hasText: true,
  hasRule: true,
});
state('network error: transport failure outranks provisional success', 'network-error', {
  phase: 'network-error',
  focused: true,
  hasText: true,
  hasRule: true,
});

const states: SweetSpiralState[] = [
  'idle',
  'focused',
  'typing',
  'submitted',
  'parsing',
  'clarification',
  'understood',
  'partial',
  'parser-error',
  'network-error',
];
t(
  'every visual state has a non-motion status label',
  states.every((visualState) => SWEET_SPIRAL_STATUS[visualState].trim().length > 0)
);

/* ---- Browserless source contracts --------------------------------------- */

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const spiralSource = source('../src/app/features/workflows/ui/sweet-spiral.ts');
const composerSource = source('../src/app/features/workflows/pages/workflow-composer.page.ts');
const builderSource = source('../src/app/features/workflows/pages/workflow-builder.page.ts');
const detailSource = source('../src/app/features/workflows/pages/workflow-detail.page.ts');
const listSource = source('../src/app/features/workflows/pages/workflows-list.page.ts');
const proposalsSource = source('../src/app/features/workflows/pages/proposals.page.ts');
const stylesSource = source('../src/styles.scss');
const angularSource = source('../angular.json');
const appSource = source('../src/app/app.html');
const appStylesSource = source('../src/app/app.scss');
const primitivesSource = source('../src/app/shared/lj/lj.ts');
const routesSource = source('../src/app/features/workflows/workflows.routes.ts');
const accessPolicySource = source(
  '../src/app/features/workflows/data/workflow-access-policy.ts'
);

t(
  'spiral CSS provides a prefers-reduced-motion mode',
  /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(spiralSource) &&
    /animation:\s*none\s*!important/.test(spiralSource) &&
    /transition-duration:\s*1ms\s*!important/.test(spiralSource)
);
t(
  'typing and pointer animation honor the runtime reduced-motion preference',
  /matchMedia\(['"]\(prefers-reduced-motion:\s*reduce\)['"]\)/.test(spiralSource) &&
    /if\s*\([^)]*reducedMotion[^)]*\)\s*return/.test(spiralSource)
);
t(
  'coarse pointers receive a calm non-following alternative',
  /@media[^\{]*\(pointer:\s*coarse\)/.test(spiralSource) &&
    /matchMedia\(['"]\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)['"]\)/.test(spiralSource) &&
    /protected pointerEnter\(\)\s*{\s*if\s*\(!this\.finePointer\s*\|\|\s*this\.reducedMotion\)\s*return/.test(spiralSource) &&
    /\[data-hovered=['"]true['"]\]\s+\.hover-plane\s*{\s*animation:\s*none/.test(spiralSource)
);
t(
  'semantic workflow changes schedule bounded spiral bursts at key interaction points',
  /phase\.set\(['"]submitted['"]\);\s*this\.pulseSpiral\(\)/.test(composerSource) &&
    /private updateRule\([\s\S]*?this\.typeOut\(composed\);\s*this\.pulseSpiral\(\)/.test(composerSource) &&
    /applyClarification[\s\S]*?this\.pulseSpiral\(\)/.test(composerSource) &&
    /revision\.status === ['"]applied['"][\s\S]*?this\.pulseSpiral\(\)/.test(composerSource) &&
    /protected arrangeCanvas\(\)[\s\S]*?this\.pulseSpiral\(\)/.test(composerSource) &&
    /private addCanvasEdge\([\s\S]*?this\.pulseSpiral\(\)/.test(composerSource)
);
t(
  'spiral uses finite two-turn edit bursts, settles, and remains hover-interactive',
  /\[data-hovered=['"]true['"]\]\s+\.hover-plane/.test(spiralSource) &&
    /transform:\s*['"]rotate\(720deg\)['"]/.test(spiralSource) &&
    /duration:\s*1100/.test(spiralSource) &&
    /playState\s*===\s*['"]running['"]/.test(spiralSource) &&
    /private pulseSpiral\(\)[\s\S]*?setTimeout/.test(composerSource) &&
    !/\[data-active=['"]true['"]\]/.test(spiralSource)
);
t(
  'enterprise foundation is centralized across shell and shared primitives',
  /--sweet-canvas:\s*#f4f6f8/.test(stylesSource) &&
    /--sweet-surface:\s*#ffffff/.test(stylesSource) &&
    /--sweet-line:\s*#d8dee8/.test(stylesSource) &&
    /node_modules\/@fontsource-variable\/inter\/index\.css/.test(angularSource) &&
    /class=['"](topbar-inner|shell)['"]/.test(appSource) &&
    /width:\s*100%;/.test(primitivesSource)
);
t(
  'composer review is one bounded six-step operational report',
  /class=['"]workflow-review report-shell['"]/.test(composerSource) &&
    ['Trigger', 'Conditions', 'Actions', 'Non-matching behavior', 'Safeguards', 'Test results'].every(
      (label) => composerSource.includes(`>${label}<`)
    ) &&
    /reviewTriggerRows\(\)/.test(composerSource) &&
    /reviewConditionRows\(\)/.test(composerSource) &&
    /reviewActionRows\(\)/.test(composerSource) &&
    /reviewElseRows\(\)/.test(composerSource)
);
t(
  'review rows preserve nested logic and expose accessible column semantics',
  /groupPath:\s*logicPath\.join\(['"] › ['"]\)/.test(composerSource) &&
    /Group \$\{index \+ 1\} · \$\{node\.logic\}/.test(composerSource) &&
    /Grouping:\s*\{\{ row\.groupPath \}\}/.test(composerSource) &&
    /role=['"]table['"]/.test(composerSource) &&
    /role=['"]columnheader['"]/.test(composerSource) &&
    /\[attr\.aria-pressed\]=['"]filter\(\) === ['"]run['"]['"]/.test(composerSource)
);
t(
  'clarifications remain inline and activation-blocking inside the report',
  /class=['"]clarification-callout['"]/.test(composerSource) &&
    /data-status=['"]needs-clarification['"]/.test(composerSource) &&
    /\(click\)=['"]answer\(question, option\)['"]/.test(composerSource) &&
    /\[disabled\]=['"]gaps\(\)\.length > 0/.test(composerSource)
);
t(
  'builder renders monochrome vectors instead of emoji decoration',
  /class=['"]option-icon['"]/.test(composerSource) &&
    /class=['"]card-icon['"]/.test(composerSource) &&
    !/\{\{\s*entry\.emoji\s*\}\}/.test(composerSource) &&
    !/\{\{\s*card\.emoji\s*\}\}/.test(composerSource)
);
t(
  'list, detail, and review queue share bounded enterprise surfaces',
  /class=['"]workflow-index data-surface['"]/.test(listSource) &&
    /class=['"]workflow-detail-report report-shell['"]/.test(detailSource) &&
    /class=['"]facts metadata-strip['"]/.test(detailSource) &&
    /class=['"]queue-surface data-surface['"]/.test(proposalsSource) &&
    /class=['"]empty['"]\s+aria-labelledby=['"]empty-title['"]/.test(proposalsSource)
);
t(
  'workflow overview becomes a non-clipping two-column grid on narrow screens',
  /@media\s*\(max-width:\s*430px\)[\s\S]*?\.overview\s*{[\s\S]*?display:\s*grid;\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*?overflow:\s*visible/.test(
    listSource
  ) &&
    /\.overview p:nth-child\(odd\)\s*{\s*border-left:\s*0/.test(listSource) &&
    /\.overview p:nth-child\(n \+ 3\)\s*{\s*border-top:\s*1px solid var\(--border\)/.test(
      listSource
    )
);
t(
  'diagram supports pointer and touch node movement with a rule-backed trash target',
  /class=['"]canvas-trash['"]/.test(composerSource) &&
    /\(pointerdown\)\s*=\s*['"]nodePointerDown\(\$event, node\)['"]/.test(composerSource) &&
    /document\.addEventListener\(['"]pointermove['"]/.test(composerSource) &&
    /if\s*\(remove\)\s*this\.deleteCanvasNode\(node\.id\)/.test(composerSource) &&
    /this\.updateRule\(rule\)/.test(composerSource)
);
t(
  'diagram quick-add arranges several nodes and repairs canonical connections',
  /addCanvasNode\(type, 0, 0, true\)/.test(composerSource) &&
    /private layoutCanvasNodes\(/.test(composerSource) &&
    /private canonicalCanvasEdges\(/.test(composerSource) &&
    // 1.9.5: edges resolve as canonical topology + user overrides; delete
    // recomputes through resolveCanvasEdges, which seeds from the canonical set.
    /this\.canvasEdges\.set\(this\.resolveCanvasEdges\(remaining\)\)/.test(composerSource) &&
    /for \(const edge of this\.canonicalCanvasEdges\(nodes\)\) keys\.add/.test(composerSource) &&
    /\(click\)\s*=\s*['"]arrangeCanvas\(\)['"]/.test(composerSource) &&
    !/\(click\)\s*=\s*['"]clearCanvas\(\)['"]/.test(composerSource)
);
t(
  'diagram nodes carry stable ids so positions, selection, and user edges survive rebuilds (1.9.5)',
  /function canvasNodeId\(/.test(composerSource) &&
    /const prev = new Map\(this\.canvasNodes\(\)\.map/.test(composerSource) &&
    /private resolveCanvasEdges\(/.test(composerSource) &&
    /protected removeCanvasEdge\(/.test(composerSource) &&
    /\(click\)\s*=\s*['"]removeCanvasEdge\(edge, \$event\)['"]/.test(composerSource) &&
    !/canvasSourced/.test(composerSource)
);
t(
  'diagram: arrows add via port-drag + delete via a visible × handle; no connect-mode button (1.9.5)',
  // Add: the out-port drags to a target node. Delete: an always-on × per arrow.
  /\(pointerdown\)\s*=\s*['"]portPointerDown\(\$event, node\)['"]/.test(composerSource) &&
    /class=['"]canvas-edge-del['"]/.test(composerSource) &&
    // The redundant connect-mode button + its machinery are gone.
    !/connectMode/.test(composerSource) &&
    !/handleConnectClick/.test(composerSource)
);
t(
  'shape-aware connector paths stay reactive while connected nodes move',
  /function canvasNodeAnchor\(/.test(composerSource) &&
    /function canvasConnectorPath\(/.test(composerSource) &&
    /d:\s*canvasConnectorPath\(a, b\)/.test(composerSource) &&
    /this\.canvasNodes\.update\(\(nodes\)\s*=>\s*nodes\.map/.test(composerSource)
);

const textarea = composerSource.match(/<textarea\b[\s\S]*?<\/textarea>/)?.[0] ?? '';
const textareaId = textarea.match(/\bid\s*=\s*['"]([^'"]+)['"]/)?.[1];
const hasAssociatedLabel =
  textareaId !== undefined &&
  (composerSource.includes(`for="${textareaId}"`) || composerSource.includes(`for='${textareaId}'`));
t('composer uses a genuine textarea', textarea.startsWith('<textarea'));
t(
  'visually minimal textarea retains an accessible name',
  /\baria-label\s*=|\baria-labelledby\s*=/.test(textarea) || hasAssociatedLabel
);
t('composer handles keyboard input on the real textarea', /\(keydown\)\s*=/.test(textarea));
t(
  'Enter submits while Shift+Enter remains available for a newline',
  /\.key\s*===\s*['"]Enter['"]/.test(composerSource) &&
    /\.shiftKey/.test(composerSource) &&
    /\.preventDefault\(\)/.test(composerSource)
);

// The current composer exposes an action after parsing, so unresolved gaps
// must remain in that action's disabled condition. If that action is removed,
// this contract intentionally fails instead of silently losing the safety gate.
const hasPostParseAction = /Start observing|Start in observation mode|Activate workflow|Test workflow/.test(
  composerSource
);
t('post-parse composer action exists for the partial-state gate', hasPostParseAction);
t(
  'a partial interpretation disables observation or activation in the template',
  /\[disabled\]\s*=\s*['"][^'"]*gaps\(\)\.length\s*>\s*0[^'"]*['"]/.test(composerSource)
);
t(
  'the save path independently rejects gaps and invalid rules',
  /if\s*\(!rule\s*\|\|\s*this\.gaps\(\)\.length\s*>\s*0\)\s*return/.test(composerSource) &&
    /validateRule\(rule\)/.test(composerSource)
);

t(
  'builder draft envelopes persist optional parse provenance',
  /interface DraftEnvelope\s*{[\s\S]*?parseMeta\?: ParseResult \| null;[\s\S]*?}/.test(
    builderSource
  ) && /parseMeta:\s*this\.parseMeta\(\)/.test(builderSource)
);
t(
  'restoring a draft restores provenance and rebinds its rule reference',
  /this\.parseMeta\.set\(draft\.parseMeta\s*\?\s*{\s*\.\.\.draft\.parseMeta,\s*rule:\s*draft\.rule\s*}\s*:\s*null\)/.test(
    builderSource
  )
);
t(
  'manual and policy edits retain parser sidecars',
  /protected setRule\(rule: WorkflowRule\)\s*{[\s\S]*?this\.rebindParseMeta\(rule\);[\s\S]*?}/.test(
    builderSource
  ) && !/protected setRule\(rule: WorkflowRule\)\s*{[\s\S]*?this\.parseMeta\.set\(null\)/.test(builderSource)
);
t(
  'builder lifecycle status treats disabled records as paused',
  /if\s*\(!this\.enabled\(\)\)\s*return ['"]Paused['"]/.test(builderSource) &&
    /this\.enabled\.set\(record\.enabled\)/.test(builderSource) &&
    /this\.enabled\.set\(outcome\.record\.enabled\)/.test(builderSource)
);
t(
  'internal editor route is guarded by a fail-closed host policy',
  /path:\s*['"]:id\/edit['"][\s\S]*?canActivate:\s*\[requireInternalWorkflowTools\]/.test(
    routesSource
  ) && /canUseInternalTools:\s*false/.test(accessPolicySource)
);
t(
  'internal editor access and writes require audit records',
  /action:\s*['"]internal-tools-opened['"]/.test(accessPolicySource) &&
    /action:\s*['"]definition-write-requested['"]/.test(builderSource) &&
    /could not be audited/.test(builderSource)
);
t(
  'client detail hides internal tools without the granted capability',
  /@if\s*\(canUseInternalTools\)\s*{[\s\S]*?Open internal tools/.test(detailSource)
);

if (failures) {
  console.error(`\n${failures} of ${assertions} Sweet UX assertion(s) FAILED`);
  process.exit(1);
}

console.log(`\nAll ${assertions} Sweet UX assertions passed.`);
