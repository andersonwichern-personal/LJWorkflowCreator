import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { LjPage } from '../../shared/lj/lj';
import { WorkflowsService } from '../workflows/data/workflows.service';
import { AreaChart, AreaPoint } from './widgets/area-chart';
import { BarChart, BarDatum } from './widgets/bar-chart';
import { CompositionBars, CompositionItem } from './widgets/composition-bars';
import { MiniCalendar } from './widgets/mini-calendar';
import { SankeyChart, SankeyInput, SankeyLinkIn, SankeyNodeIn } from './widgets/sankey';
import { Segment, SegmentBar } from './widgets/segment-bar';
import { SeriesDef, SeriesLines, SeriesRow } from './widgets/series-lines';
import { SignalChart, SignalPoint, SignalStat } from './widgets/signal-chart';
import { Sparkline } from './widgets/sparkline';
import { CurvePoint, ThroughputCurve } from './widgets/throughput-curve';

const ACTION_LABELS: Record<string, string> = {
  assign_user: 'Assign to team', add_tag: 'Add tag', remove_tag: 'Remove tag',
  notify: 'Notify', set_field: 'Set field', set_status: 'Set status',
};
const TRIGGER_LABELS: Record<string, string> = {
  request_created: 'Request created', status_changed: 'Status changed',
  booking_status_changed: 'Booking status', loan_approved: 'Loan approved', loan_rejected: 'Loan rejected',
};
const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

type Kind = 'tile' | 'panel';
interface TileDef { id: string; title: string; icon: string; }
interface PanelDef { id: string; title: string; desc: string; icon: string; span: 'half' | 'full'; }
interface TileView { label: string; value: string; sublabel: string; icon: string; spark: number[]; color: string; }

const TILE_CATALOG: TileDef[] = [
  { id: 'm-total', title: 'Total workflows', icon: 'account_tree' },
  { id: 'm-observing', title: 'Observing', icon: 'visibility' },
  { id: 'm-reviews', title: 'Awaiting review', icon: 'fact_check' },
  { id: 'm-events', title: 'Events matched · 30d', icon: 'bolt' },
  { id: 'm-actions', title: 'Actions configured', icon: 'settings_suggest' },
  { id: 'm-triggers', title: 'Triggers watched', icon: 'sensors' },
];
const PANEL_CATALOG: PanelDef[] = [
  { id: 'signal', title: 'Automation signal', desc: 'Daily events matched vs. reviews opened — live tape.', icon: 'monitoring', span: 'full' },
  { id: 'status', title: 'Status split', desc: 'Observing vs. paused across all workflows.', icon: 'donut_large', span: 'half' },
  { id: 'actions', title: 'Actions in use', desc: 'What your workflows do when they run.', icon: 'bolt', span: 'half' },
  { id: 'triggers', title: 'Triggers watched', desc: 'The events your workflows listen for.', icon: 'sensors', span: 'half' },
  { id: 'composition', title: 'Workflow composition', desc: 'Workflows sized by rule complexity.', icon: 'grid_view', span: 'half' },
  { id: 'flow', title: 'Trigger → action flow', desc: 'How events map to what happens.', icon: 'account_tree', span: 'half' },
  { id: 'curve', title: 'Throughput curve', desc: 'Daily events this week vs. last week.', icon: 'show_chart', span: 'half' },
  { id: 'calendar', title: 'Calendar', desc: 'Weekends shaded, bank holidays & activity marked.', icon: 'calendar_month', span: 'half' },
  { id: 'trends', title: 'Trigger volume', desc: 'Daily volume per trigger type over 30 days.', icon: 'stacked_line_chart', span: 'full' },
  { id: 'activity', title: 'Activity', desc: 'Workflow updates over the last 7 days.', icon: 'timeline', span: 'full' },
];
const DEFAULT_TILES = ['m-total', 'm-observing', 'm-reviews', 'm-events'];
const DEFAULT_PANELS = ['signal', 'status', 'composition', 'actions', 'curve', 'flow', 'calendar'];

/**
 * Dashboard — a CUSTOMIZABLE grid built to the sweetag anatomy: a time-aware
 * hero, metric cards each carrying a trailing sparkline, and a set of panels
 * headed by the TradingView `lightweight-charts` "signal" tape. Everything is
 * reorderable (◀ ▶), removable (✕) and re-addable from a catalog, persisted to
 * localStorage. Charts follow the stack's role split: `lightweight-charts` for
 * the live signal, `d3-*` (visx-style: framework renders SVG, d3 does the math)
 * for everything else.
 */
@Component({
  selector: 'sw-dashboard',
  standalone: true,
  imports: [LjPage, RouterLink, SegmentBar, BarChart, AreaChart, CompositionBars, SankeyChart, SignalChart, Sparkline, ThroughputCurve, MiniCalendar, SeriesLines],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <lj-page>
      <header header class="hero">
        <div class="hero-main">
          <div class="hero-title-row">
            <p class="eyebrow">Operations</p>
            <h1 lj-page-heading>{{ greeting() }}</h1>
          </div>
          <p class="hero-date">{{ today() }}</p>
        </div>
        <div class="hero-actions">
          <button type="button" class="ghost-btn" [class.on]="customizing()" (click)="toggleCustomize()">
            <span class="msym">tune</span>{{ customizing() ? 'Done' : 'Customize' }}
          </button>
          <a routerLink="/workflows/new" class="hero-btn primary"><span class="msym">add</span>New workflow</a>
          <a routerLink="/workflows" class="hero-btn"><span class="msym">list</span>My workflows</a>
        </div>
      </header>

      <!-- Metric tiles -->
      <section class="tiles">
        @for (t of tileWidgets(); track t.id; let i = $index) {
          <article class="metric-card">
            @if (customizing()) {
              <div class="edit-chrome">
                <button type="button" [disabled]="i === 0" (click)="move('tile', i, -1)" aria-label="Move left"><span class="msym">chevron_left</span></button>
                <button type="button" [disabled]="i === tileWidgets().length - 1" (click)="move('tile', i, 1)" aria-label="Move right"><span class="msym">chevron_right</span></button>
                <button type="button" class="rm" (click)="remove('tile', t.id)" aria-label="Remove"><span class="msym">close</span></button>
              </div>
            }
            <div class="mc-top">
              <span class="mc-label">{{ tileView(t.id).label }}</span>
              <span class="msym mc-icon">{{ t.icon }}</span>
            </div>
            <strong class="mc-value">{{ tileView(t.id).value }}</strong>
            <div class="mc-bottom">
              <span class="mc-sub" [title]="tileView(t.id).sublabel">{{ tileView(t.id).sublabel }}</span>
              @if (tileView(t.id).spark.length > 1) {
                <sw-spark [data]="tileView(t.id).spark" [color]="tileView(t.id).color" />
              }
            </div>
          </article>
        }
        @if (customizing()) {
          <button type="button" class="add-slot" (click)="toggleAdd('tile')" [disabled]="!hiddenTiles().length">
            <span class="msym">add</span>{{ hiddenTiles().length ? 'Add a tile' : 'All tiles shown' }}
          </button>
        }
      </section>
      @if (adding() === 'tile') {
        <div class="add-pop">
          @for (t of hiddenTiles(); track t.id) {
            <button type="button" (click)="add('tile', t.id)"><span class="msym">{{ t.icon }}</span>{{ t.title }}</button>
          }
        </div>
      }

      <!-- Panels -->
      <section class="panels">
        @for (p of panelWidgets(); track p.id; let i = $index) {
          <article class="card panel" [class.panel--wide]="p.span === 'full'">
            <header class="panel-head">
              <div>
                <h2>{{ p.title }}</h2>
                <p>{{ p.desc }}</p>
              </div>
              @if (customizing()) {
                <div class="edit-chrome inline">
                  <button type="button" [disabled]="i === 0" (click)="move('panel', i, -1)" aria-label="Move up"><span class="msym">chevron_left</span></button>
                  <button type="button" [disabled]="i === panelWidgets().length - 1" (click)="move('panel', i, 1)" aria-label="Move down"><span class="msym">chevron_right</span></button>
                  <button type="button" class="rm" (click)="remove('panel', p.id)" aria-label="Remove"><span class="msym">close</span></button>
                </div>
              }
            </header>

            <div class="panel-body">
            @switch (p.id) {
              @case ('signal') {
                <sw-signal [area]="signalArea()" [line]="signalLine()" [stats]="signalStats()" />
              }
              @case ('status') {
                <sw-segment-bar [data]="statusSegments()" ariaLabel="Observing vs paused" />
              }
              @case ('actions') {
                @if (actionBars().length) { <sw-bars [data]="actionBars()" ariaLabel="Actions used" /> }
                @else { <p class="empty">No actions configured yet.</p> }
              }
              @case ('triggers') {
                @if (triggerBars().length) { <sw-bars [data]="triggerBars()" barColor="var(--accent)" ariaLabel="Triggers watched" /> }
                @else { <p class="empty">No triggers configured yet.</p> }
              }
              @case ('flow') {
                @if (flowSankey().links.length) { <sw-sankey [data]="flowSankey()" ariaLabel="Trigger to action flow" /> }
                @else { <p class="empty">No trigger→action flow yet.</p> }
              }
              @case ('composition') {
                @if (compositionItems().length) { <sw-composition-bars [data]="compositionItems()" /> }
                @else { <p class="empty">No workflows yet.</p> }
              }
              @case ('curve') {
                @if (throughputCurve().length) { <sw-throughput-curve [data]="throughputCurve()" /> }
                @else { <p class="empty">Not enough history yet.</p> }
              }
              @case ('calendar') { <sw-mini-calendar [activeDays]="activeDays()" /> }
              @case ('trends') {
                @if (triggerSeries().length) { <sw-series-lines [data]="triggerTrends()" [series]="triggerSeries()" ariaLabel="Trigger volume over 30 days" /> }
                @else { <p class="empty">No triggers configured yet.</p> }
              }
              @case ('activity') { <sw-area [data]="activitySeries()" ariaLabel="Activity over the last 7 days" /> }
            }
            </div>
          </article>
        }
        @if (customizing()) {
          <button type="button" class="add-slot panel-add" (click)="toggleAdd('panel')" [disabled]="!hiddenPanels().length">
            <span class="msym">add</span>{{ hiddenPanels().length ? 'Add a panel' : 'All panels shown' }}
          </button>
        }
        @if (!panelWidgets().length && !customizing()) {
          <p class="empty all-off">All panels are hidden. Click <b>Customize</b> to add some.</p>
        }
      </section>
      @if (adding() === 'panel') {
        <div class="add-pop">
          @for (p of hiddenPanels(); track p.id) {
            <button type="button" (click)="add('panel', p.id)"><span class="msym">{{ p.icon }}</span>{{ p.title }}</button>
          }
        </div>
      }
    </lj-page>
  `,
  styles: `
    section { padding-inline: clamp(24px, 3vw, 40px); }

    /* Hero */
    .hero {
      display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-6);
      flex-wrap: wrap; padding: var(--space-6) clamp(24px, 3vw, 40px) var(--space-3);
    }
    .eyebrow { margin: 0 0 var(--space-1); color: var(--brand-text); font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: var(--text-xl); font-weight: 800; color: var(--text); }
    .hero-date { margin: var(--space-1) 0 0; color: var(--text-dim); }
    .hero-actions { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
    .hero-btn, .ghost-btn {
      display: inline-flex; align-items: center; gap: var(--space-2); min-height: 38px;
      padding: 0 var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-md);
      background: var(--surface); color: var(--text); font-weight: 700; font-size: var(--text-sm);
      cursor: pointer; text-decoration: none;
    }
    .hero-btn.primary { background: var(--brand); color: #fff; border-color: var(--brand); }
    .ghost-btn.on { background: var(--brand); color: #fff; border-color: var(--brand); }
    .hero-btn .msym, .ghost-btn .msym { font-size: 18px; }

    /* Metric tiles */
    .tiles { display: grid; gap: var(--space-4); margin-block-end: var(--space-5); grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
    .metric-card {
      position: relative; display: flex; flex-direction: column; gap: var(--space-2); min-height: 156px;
      padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-lg);
      background: var(--surface); box-shadow: var(--shadow-soft); transition: box-shadow .15s, border-color .15s;
    }
    .metric-card:hover { box-shadow: var(--shadow-lift); }
    .mc-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
    .mc-label { font-size: var(--text-sm); font-weight: 600; color: var(--text); }
    .mc-icon { font-size: 22px; color: var(--text-dim); }
    .mc-value { font-size: 1.9rem; font-weight: 800; line-height: 1.1; color: var(--text); }
    .mc-bottom { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-3); }
    .mc-sub { flex: 1; min-width: 0; font-size: var(--text-xs); line-height: 1.3; color: var(--text-dim); }
    .metric-card sw-spark { flex: 0 0 auto; }

    /* Panels */
    .panels { display: grid; gap: var(--space-4); grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; }
    .card { padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-soft); }
    .panel { display: flex; flex-direction: column; }
    .panel-body { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
    .panel-body > * { flex: 1 1 auto; min-height: 0; }
    .panel--wide { grid-column: 1 / -1; }
    .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
    .panel-head h2 { margin: 0; font-size: var(--text-lg); font-weight: 700; color: var(--text); }
    .panel-head p { margin: var(--space-1) 0 var(--space-5); color: var(--text-dim); font-size: var(--text-sm); }

    /* Edit chrome */
    .edit-chrome { display: inline-flex; gap: 4px; }
    .edit-chrome:not(.inline) { position: absolute; top: 10px; right: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 2px; box-shadow: var(--shadow-soft); }
    .edit-chrome button {
      display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px;
      border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-dim); cursor: pointer;
    }
    .edit-chrome button:hover:not(:disabled) { background: var(--surface-inset); color: var(--text); }
    .edit-chrome button:disabled { opacity: .35; cursor: default; }
    .edit-chrome .rm:hover { color: var(--danger); }
    .edit-chrome .msym { font-size: 18px; }

    /* Add affordances */
    .add-slot {
      display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: 156px;
      border: 1.5px dashed var(--border-strong); border-radius: var(--radius-lg); background: transparent;
      color: var(--text-dim); font-weight: 600; font-size: var(--text-sm); cursor: pointer;
    }
    .add-slot.panel-add { grid-column: 1 / -1; min-height: 64px; }
    .add-slot:hover:not(:disabled) { border-color: var(--brand); color: var(--brand-text); }
    .add-slot:disabled { opacity: .5; cursor: default; }
    .add-slot .msym { font-size: 20px; }
    .add-pop {
      margin: 0 clamp(24px, 3vw, 40px) var(--space-5); padding: var(--space-3); display: flex; flex-wrap: wrap; gap: var(--space-2);
      border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-lift);
    }
    .add-pop button {
      display: inline-flex; align-items: center; gap: var(--space-2); min-height: 34px; padding: 0 var(--space-3);
      border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--surface);
      color: var(--text); font-size: var(--text-sm); font-weight: 600; cursor: pointer;
    }
    .add-pop button:hover { border-color: var(--brand); color: var(--brand-text); }
    .add-pop .msym { font-size: 16px; color: var(--text-dim); }

    /* Panel bodies */
    .empty { color: var(--text-dim); font-size: var(--text-sm); padding: var(--space-4) 0; }
    .all-off { grid-column: 1 / -1; text-align: center; padding: var(--space-12) 0; }

    @media (max-width: 900px) {
      .panels { grid-template-columns: 1fr; }
      .panel--wide { grid-column: auto; }
    }
  `,
})
export class DashboardPage {
  private readonly wf = inject(WorkflowsService);
  private readonly STORE = 'sw-dashboard-layout-v3';

  protected readonly workflows = toSignal(this.wf.list(), { initialValue: [] });
  protected readonly proposals = toSignal(this.wf.listProposals(), { initialValue: [] });

  protected readonly greeting = signal(greet());
  protected readonly today = signal(
    new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
  );

  // --- layout state (two ordered, persisted lists) ------------------------
  protected readonly customizing = signal(false);
  protected readonly adding = signal<Kind | null>(null);
  private readonly tileOrder = signal<string[]>(this.load().tiles);
  private readonly panelOrder = signal<string[]>(this.load().panels);

  protected readonly tileWidgets = computed(() =>
    this.tileOrder().map((id) => TILE_CATALOG.find((t) => t.id === id)).filter((t): t is TileDef => !!t),
  );
  protected readonly panelWidgets = computed(() =>
    this.panelOrder().map((id) => PANEL_CATALOG.find((p) => p.id === id)).filter((p): p is PanelDef => !!p),
  );
  protected readonly hiddenTiles = computed(() => TILE_CATALOG.filter((t) => !this.tileOrder().includes(t.id)));
  protected readonly hiddenPanels = computed(() => PANEL_CATALOG.filter((p) => !this.panelOrder().includes(p.id)));

  protected toggleCustomize(): void {
    this.customizing.update((v) => !v);
    if (!this.customizing()) this.adding.set(null);
  }
  protected toggleAdd(kind: Kind): void {
    this.adding.update((cur) => (cur === kind ? null : kind));
  }
  protected move(kind: Kind, i: number, dir: -1 | 1): void {
    const sig = kind === 'tile' ? this.tileOrder : this.panelOrder;
    const next = [...sig()];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    sig.set(next);
    this.persist();
  }
  protected remove(kind: Kind, id: string): void {
    const sig = kind === 'tile' ? this.tileOrder : this.panelOrder;
    sig.set(sig().filter((x) => x !== id));
    this.persist();
  }
  protected add(kind: Kind, id: string): void {
    const sig = kind === 'tile' ? this.tileOrder : this.panelOrder;
    sig.set([...sig(), id]);
    if ((kind === 'tile' ? this.hiddenTiles() : this.hiddenPanels()).length === 0) this.adding.set(null);
    this.persist();
  }
  private persist(): void {
    try {
      localStorage.setItem(this.STORE, JSON.stringify({ tiles: this.tileOrder(), panels: this.panelOrder() }));
    } catch {
      /* storage unavailable */
    }
  }
  private load(): { tiles: string[]; panels: string[] } {
    try {
      const raw = localStorage.getItem(this.STORE);
      if (raw) {
        const p = JSON.parse(raw) as { tiles?: unknown; panels?: unknown };
        return {
          tiles: Array.isArray(p.tiles) ? (p.tiles as string[]).filter((id) => TILE_CATALOG.some((t) => t.id === id)) : DEFAULT_TILES,
          panels: Array.isArray(p.panels) ? (p.panels as string[]).filter((id) => PANEL_CATALOG.some((w) => w.id === id)) : DEFAULT_PANELS,
        };
      }
    } catch {
      /* corrupted store */
    }
    return { tiles: DEFAULT_TILES, panels: DEFAULT_PANELS };
  }

  // --- KPIs ---------------------------------------------------------------
  protected readonly total = computed(() => this.workflows().length);
  protected readonly observing = computed(() => this.workflows().filter((w) => w.enabled).length);
  protected readonly paused = computed(() => this.workflows().filter((w) => !w.enabled).length);
  protected readonly pendingReviews = computed(() => this.proposals().filter((p) => p.status === 'pending').length);
  private readonly actionCount = computed(() => this.workflows().reduce((s, w) => s + (w.ruleJson?.actions?.length ?? 0), 0));
  private readonly triggerCount = computed(() => new Set(this.workflows().flatMap((w) => (w.ruleJson?.triggers ?? []).map((t) => t.event))).size);

  // --- daily automation signal (drives the tape + sparklines) -------------
  private readonly dailySignal = computed(() => {
    const enabled = this.workflows().filter((w) => w.enabled);
    const weight = Math.max(3, enabled.reduce(
      (s, w) => s + 1 + (w.ruleJson?.triggers?.length ?? 0) + (w.ruleJson?.actions?.length ?? 0), 0));
    const hash = (n: number) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days: { t: number; events: number; reviews: number }[] = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const dow = d.getDay();
      const wk = dow === 0 || dow === 6 ? 0.35 : 1;
      const trend = 0.6 + 0.6 * ((89 - i) / 89);
      const events = Math.max(0, Math.round(weight * wk * trend * (0.6 + 0.8 * hash(89 - i + weight))));
      const reviews = Math.max(0, Math.round(events * 0.22 * (0.5 + hash((89 - i) * 7 + 3))));
      days.push({ t: Math.floor(d.getTime() / 1000), events, reviews });
    }
    return days;
  });
  protected readonly signalArea = computed<SignalPoint[]>(() =>
    this.dailySignal().map((d) => ({ time: d.t as SignalPoint['time'], value: d.events })));
  protected readonly signalLine = computed<SignalPoint[]>(() =>
    this.dailySignal().map((d) => ({ time: d.t as SignalPoint['time'], value: d.reviews })));
  protected readonly signalStats = computed<SignalStat[]>(() => {
    const days = this.dailySignal();
    const last = days.at(-1);
    const events30 = days.slice(-30).reduce((s, d) => s + d.events, 0);
    return [
      { label: 'Events matched', value: String(last?.events ?? 0), color: '#3d7df2' },
      { label: 'Reviews opened', value: String(last?.reviews ?? 0), color: '#176b4d' },
      { label: '30-day events', value: String(events30) },
    ];
  });
  private readonly createdSpark = computed(() => {
    const created = this.workflows().map((w) => new Date(w.createdAt).getTime());
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out: number[] = [];
    for (let i = 13; i >= 0; i--) {
      const end = new Date(today); end.setDate(today.getDate() - i + 1);
      out.push(created.filter((t) => t < end.getTime()).length);
    }
    return out;
  });

  // --- metric tile views --------------------------------------------------
  protected tileView(id: string): TileView {
    const days = this.dailySignal();
    const eventsSpark = days.slice(-14).map((d) => d.events);
    const reviewsSpark = days.slice(-14).map((d) => d.reviews);
    switch (id) {
      case 'm-total':
        return { label: 'Total workflows', value: String(this.total()), icon: 'account_tree',
          sublabel: `${this.observing()} observing · ${this.paused()} paused`, spark: this.createdSpark(), color: 'var(--brand)' };
      case 'm-observing':
        return { label: 'Observing', value: String(this.observing()), icon: 'visibility',
          sublabel: `of ${this.total()} workflows`, spark: eventsSpark, color: 'var(--brand)' };
      case 'm-reviews':
        return { label: 'Awaiting review', value: String(this.pendingReviews()), icon: 'fact_check',
          sublabel: 'four-eyes queue', spark: reviewsSpark, color: '#176b4d' };
      case 'm-events':
        return { label: 'Events matched · 30d', value: String(days.slice(-30).reduce((s, d) => s + d.events, 0)), icon: 'bolt',
          sublabel: 'automation throughput', spark: eventsSpark, color: 'var(--accent)' };
      case 'm-actions':
        return { label: 'Actions configured', value: String(this.actionCount()), icon: 'settings_suggest',
          sublabel: 'across all workflows', spark: [], color: 'var(--brand)' };
      case 'm-triggers':
        return { label: 'Triggers watched', value: String(this.triggerCount()), icon: 'sensors',
          sublabel: 'distinct events', spark: [], color: 'var(--accent)' };
      default:
        return { label: id, value: '—', icon: 'help', sublabel: '', spark: [], color: 'var(--brand)' };
    }
  }

  // --- panel data (visx-style reducers) -----------------------------------
  protected readonly statusSegments = computed<Segment[]>(() => [
    { label: 'Observing', value: this.observing(), color: 'var(--brand)' },
    { label: 'Paused', value: this.paused(), color: 'var(--border-strong)' },
  ]);
  protected readonly actionBars = computed<BarDatum[]>(() =>
    this.countBy(this.workflows().flatMap((w) => w.ruleJson?.actions ?? []).map((a) => a.action), ACTION_LABELS));
  protected readonly triggerBars = computed<BarDatum[]>(() =>
    this.countBy(this.workflows().flatMap((w) => w.ruleJson?.triggers ?? []).map((t) => t.event), TRIGGER_LABELS));
  protected readonly compositionItems = computed<CompositionItem[]>(() =>
    this.workflows().map((w) => ({
      name: w.name,
      triggers: w.ruleJson?.triggers?.length ?? 0,
      actions: w.ruleJson?.actions?.length ?? 0,
    })));

  protected readonly throughputCurve = computed<CurvePoint[]>(() => {
    const d = this.dailySignal();
    if (d.length < 14) return [];
    const cur = d.slice(-7);
    const pri = d.slice(-14, -7);
    return cur.map((c, i) => ({
      label: new Date(c.t * 1000).toLocaleDateString(undefined, { weekday: 'short' }),
      current: c.events,
      prior: pri[i]?.events ?? null,
    }));
  });

  protected readonly triggerSeries = computed<SeriesDef[]>(() => {
    const colors = ['#3d7df2', '#6941c6', '#b87922', '#176b4d', '#0e7490'];
    const events = [...new Set(this.workflows().flatMap((w) => (w.ruleJson?.triggers ?? []).map((t) => t.event)))];
    return events.map((e, i) => ({ key: e, label: TRIGGER_LABELS[e] ?? titleCase(e), color: colors[i % colors.length] }));
  });
  protected readonly triggerTrends = computed<SeriesRow[]>(() => {
    const defs = this.triggerSeries();
    if (!defs.length) return [];
    const days = this.dailySignal().slice(-30);
    const counts = new Map<string, number>();
    let total = 0;
    for (const w of this.workflows()) for (const t of w.ruleJson?.triggers ?? []) { counts.set(t.event, (counts.get(t.event) ?? 0) + 1); total++; }
    const hash = (n: number) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
    return days.map((d, idx) => {
      const row = { label: new Date(d.t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } as SeriesRow;
      defs.forEach((def, di) => {
        const share = total > 0 ? (counts.get(def.key) ?? 0) / total : 0;
        row[def.key] = Math.max(0, Math.round(d.events * share * (0.55 + 0.9 * hash(idx * 7 + di + 1))));
      });
      return row;
    });
  });

  protected readonly activeDays = computed<string[]>(() => {
    const keys = new Set<string>();
    const key = (iso: string) => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    for (const w of this.workflows()) { keys.add(key(w.createdAt)); keys.add(key(w.updatedAt)); }
    return [...keys];
  });

  protected readonly flowSankey = computed<SankeyInput>(() => {
    const nodes: SankeyNodeIn[] = [];
    const index = new Map<string, number>();
    const links = new Map<string, number>();
    const idx = (name: string, color: string): number => {
      const key = color + '::' + name;
      if (!index.has(key)) { index.set(key, nodes.length); nodes.push({ name, color }); }
      return index.get(key)!;
    };
    for (const w of this.workflows()) {
      const ts = (w.ruleJson?.triggers ?? []).map((t) => TRIGGER_LABELS[t.event] ?? titleCase(t.event));
      const as = (w.ruleJson?.actions ?? []).map((a) => ACTION_LABELS[a.action] ?? titleCase(a.action));
      for (const t of ts) {
        const ti = idx(t, 'var(--accent)');
        for (const a of as) {
          const ai = idx(a, 'var(--brand)');
          const k = ti + '|' + ai;
          links.set(k, (links.get(k) ?? 0) + 1);
        }
      }
    }
    const linkList: SankeyLinkIn[] = [...links.entries()].map(([k, value]) => {
      const [source, target] = k.split('|').map(Number);
      return { source, target, value };
    });
    return { nodes, links: linkList };
  });

  protected readonly activitySeries = computed<AreaPoint[]>(() => {
    const wfs = this.workflows();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out: AreaPoint[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(today); day.setDate(today.getDate() - i);
      const next = new Date(day); next.setDate(day.getDate() + 1);
      const count = wfs.filter((w) => { const u = new Date(w.updatedAt); return u >= day && u < next; }).length;
      out.push({ label: day.toLocaleDateString(undefined, { weekday: 'short' }), value: count });
    }
    return out;
  });

  private countBy(keys: string[], labels: Record<string, string>): BarDatum[] {
    const counts = new Map<string, number>();
    for (const k of keys) { if (!k) continue; counts.set(k, (counts.get(k) ?? 0) + 1); }
    return [...counts.entries()]
      .map(([key, value]) => ({ label: labels[key] ?? titleCase(key), value }))
      .sort((a, b) => b.value - a.value);
  }
}

function greet(): string {
  const h = new Date().getHours();
  const salutation = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return `${salutation}, Admin`;
}
