import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { max } from 'd3-array';
import { scaleLinear } from 'd3-scale';
import { curveMonotoneX, line } from 'd3-shape';

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}
export type SeriesRow = { label: string } & Record<string, number>;

/**
 * Multi-line series — the sweetag `SeriesChart` idiom (recharts there; here
 * visx-style with `d3-scale`/`d3-shape`). Several lines over a shared x-axis
 * with a legend, for "N categories trending over time" (e.g. per-trigger daily
 * volume).
 */
@Component({
  selector: 'sw-series-lines',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legend">
      @for (s of series; track s.key) {
        <span><span class="ln" [style.background]="s.color"></span>{{ s.label }}</span>
      }
    </div>
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="ariaLabel">
      @for (t of yTicks(); track t.v) {
        <line class="grid" [attr.x1]="M.l" [attr.x2]="W - M.r" [attr.y1]="t.y" [attr.y2]="t.y" />
        <text class="ax" [attr.x]="M.l - 6" [attr.y]="t.y" text-anchor="end" dy="0.32em">{{ t.v }}</text>
      }
      @for (p of paths(); track p.key) {
        <path [attr.d]="p.d" fill="none" [attr.stroke]="p.color" stroke-width="2" />
      }
      @for (x of xLabels(); track x.i) {
        <text class="ax" [attr.x]="x.x" [attr.y]="H - 6" text-anchor="middle">{{ x.label }}</text>
      }
    </svg>
  `,
  styles: `
    :host { display: flex; flex-direction: column; justify-content: center; }
    .legend { display: flex; flex-wrap: wrap; gap: var(--space-4); margin-block-end: var(--space-2); color: var(--text-dim); font-size: var(--text-xs); flex: 0 0 auto; }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .ln { width: 16px; height: 2px; display: inline-block; border-radius: 1px; }
    svg { display: block; width: 100%; height: auto; overflow: visible; }
    .grid { stroke: var(--border); stroke-width: 1; }
    .ax { font: 500 0.6rem var(--font-sans); fill: var(--text-dim); }
  `,
})
export class SeriesLines {
  @Input() set data(v: SeriesRow[]) {
    this._data.set(v ?? []);
  }
  @Input() set series(v: SeriesDef[]) {
    this._series.set(v ?? []);
  }
  get series(): SeriesDef[] {
    return this._series();
  }
  @Input() ariaLabel = 'Series trends';

  private readonly _data = signal<SeriesRow[]>([]);
  private readonly _series = signal<SeriesDef[]>([]);
  readonly W = 520;
  readonly H = 210;
  readonly M = { t: 10, r: 10, b: 26, l: 30 };

  private readonly scales = computed(() => {
    const data = this._data();
    const series = this._series();
    const hi = max(data, (row) => max(series, (s) => row[s.key] ?? 0)) || 1;
    const x = scaleLinear().domain([0, Math.max(1, data.length - 1)]).range([this.M.l, this.W - this.M.r]);
    const y = scaleLinear().domain([0, hi]).nice().range([this.H - this.M.b, this.M.t]);
    return { data, series, x, y };
  });

  readonly yTicks = computed(() => {
    const { y } = this.scales();
    return y.ticks(4).map((v) => ({ v, y: y(v) }));
  });
  readonly paths = computed(() => {
    const { data, series, x, y } = this.scales();
    return series.map((s) => ({
      key: s.key,
      color: s.color,
      d: line<SeriesRow>().x((_, i) => x(i)).y((row) => y(row[s.key] ?? 0)).curve(curveMonotoneX)(data) ?? '',
    }));
  });
  readonly xLabels = computed(() => {
    const { data, x } = this.scales();
    if (!data.length) return [];
    const step = Math.max(1, Math.ceil(data.length / 6));
    const out: { i: number; x: number; label: string }[] = [];
    for (let i = 0; i < data.length; i += step) out.push({ i, x: x(i), label: data[i].label });
    return out;
  });
}
