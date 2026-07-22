import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { max, min } from 'd3-array';
import { scaleLinear, scalePoint } from 'd3-scale';
import { line } from 'd3-shape';

export interface CurvePoint {
  label: string;
  current: number | null;
  prior: number | null;
}

const CURRENT_COLOR = '#3d7df2';
const PRIOR_COLOR = '#9ca38a';

/**
 * Throughput curve — the sweetag yield-curve idiom ported to Angular
 * (visx-style: `d3-scale`/`d3-shape` build the geometry, the template renders
 * the SVG). Two series across an ordered x-axis: this week's daily events
 * (solid) vs last week's (dashed), so shifts jump out the way today-vs-90-days
 * does on a treasury curve.
 */
@Component({
  selector: 'sw-throughput-curve',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legend">
      <span><span class="ln solid"></span>This week</span>
      <span><span class="ln dashed"></span>Last week</span>
    </div>
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" aria-label="Throughput this week vs last week">
      <!-- y grid + ticks -->
      @for (t of yTicks(); track t.v) {
        <line class="grid" [attr.x1]="M.l" [attr.x2]="W - M.r" [attr.y1]="t.y" [attr.y2]="t.y" />
        <text class="ax" [attr.x]="M.l - 6" [attr.y]="t.y" text-anchor="end" dy="0.32em">{{ t.v }}</text>
      }
      <!-- prior (dashed) -->
      <path [attr.d]="priorPath()" fill="none" [attr.stroke]="prior" stroke-width="1.5" stroke-dasharray="4,4" />
      <!-- current (solid) -->
      <path [attr.d]="currentPath()" fill="none" [attr.stroke]="current" stroke-width="2.5" />
      @for (p of pts(); track p.label) {
        <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3.5" [attr.fill]="current">
          <title>{{ p.label }}: {{ p.value }} events</title>
        </circle>
        <text class="ax" [attr.x]="p.x" [attr.y]="H - 6" text-anchor="middle">{{ p.label }}</text>
      }
    </svg>
  `,
  styles: `
    :host { display: flex; flex-direction: column; justify-content: center; }
    .legend { display: flex; gap: var(--space-4); margin-block-end: var(--space-2); color: var(--text-dim); font-size: var(--text-xs); flex: 0 0 auto; }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .ln { width: 16px; height: 2px; display: inline-block; }
    .ln.solid { background: #3d7df2; }
    .ln.dashed { background: repeating-linear-gradient(90deg, #9ca38a 0 4px, transparent 4px 8px); }
    svg { display: block; width: 100%; height: auto; overflow: visible; }
    .grid { stroke: var(--border); stroke-width: 1; }
    .ax { font: 500 0.6rem var(--font-sans); fill: var(--text-dim); }
  `,
})
export class ThroughputCurve {
  @Input() set data(v: CurvePoint[]) {
    this._data.set(v ?? []);
  }
  @Input() current = CURRENT_COLOR;
  @Input() prior = PRIOR_COLOR;

  private readonly _data = signal<CurvePoint[]>([]);
  readonly W = 520;
  readonly H = 224;
  readonly M = { t: 10, r: 12, b: 28, l: 34 };

  private readonly scales = computed(() => {
    const data = this._data();
    const vals = data.flatMap((p) => [p.current, p.prior]).filter((v): v is number => v != null);
    const lo = Math.max(0, (min(vals) ?? 0) - 1);
    const hi = (max(vals) ?? 1) + 1;
    const x = scalePoint<string>().domain(data.map((p) => p.label)).range([this.M.l, this.W - this.M.r]);
    const y = scaleLinear().domain([lo, hi]).nice().range([this.H - this.M.b, this.M.t]);
    return { data, x, y };
  });

  readonly yTicks = computed(() => {
    const { y } = this.scales();
    return y.ticks(4).map((v) => ({ v, y: y(v) }));
  });
  readonly pts = computed(() => {
    const { data, x, y } = this.scales();
    return data
      .filter((p) => p.current != null)
      .map((p) => ({ label: p.label, value: p.current as number, x: x(p.label) ?? 0, y: y(p.current as number) }));
  });
  readonly currentPath = computed(() => this.pathFor('current'));
  readonly priorPath = computed(() => this.pathFor('prior'));

  private pathFor(key: 'current' | 'prior'): string {
    const { data, x, y } = this.scales();
    const pts = data.filter((p) => p[key] != null).map((p) => ({ label: p.label, v: p[key] as number }));
    return line<{ label: string; v: number }>().x((d) => x(d.label) ?? 0).y((d) => y(d.v))(pts) ?? '';
  }
}
