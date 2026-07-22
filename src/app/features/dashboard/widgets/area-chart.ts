import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { max } from 'd3-array';
import { scaleLinear, scalePoint } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';

export interface AreaPoint {
  label: string;
  value: number;
}

/**
 * Area + line — visx-style: `d3-scale`/`d3-shape` build the path strings,
 * Angular renders them. For "value over a sequence" (activity, trend).
 */
@Component({
  selector: 'sw-area',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="ariaLabel">
      <path [attr.d]="areaPath()" [attr.fill]="fill" />
      <path [attr.d]="linePath()" fill="none" [attr.stroke]="stroke" stroke-width="2.5" />
      @for (p of pts(); track p.label) {
        <circle [attr.cx]="p.cx" [attr.cy]="p.cy" r="3.5" [attr.fill]="stroke" />
      }
    </svg>
    <div class="x-axis">
      @for (p of pts(); track p.label) {
        <span [style.left.%]="p.leftPct">{{ p.label }}</span>
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; justify-content: center; }
    svg { display: block; width: 100%; height: auto; overflow: visible; }
    .x-axis { position: relative; height: 1.2rem; margin-top: 4px; }
    .x-axis span {
      position: absolute; transform: translateX(-50%);
      font: 500 0.68rem var(--font-sans); color: var(--text-dim); white-space: nowrap;
    }
  `,
})
export class AreaChart {
  @Input() set data(v: AreaPoint[]) {
    this._data.set(v ?? []);
  }
  @Input() ariaLabel = 'Area chart';
  @Input() stroke = 'var(--brand)';
  @Input() fill = 'color-mix(in srgb, var(--brand) 14%, transparent)';

  private readonly _data = signal<AreaPoint[]>([]);
  readonly W = 520;
  readonly H = 170;
  private readonly pad = { t: 10, r: 6, b: 6, l: 6 };

  private readonly scaled = computed(() => {
    const data = this._data();
    const x = scalePoint<string>()
      .domain(data.map((d) => d.label))
      .range([this.pad.l, this.W - this.pad.r]);
    const y = scaleLinear()
      .domain([0, max(data, (d) => d.value) || 1])
      .nice()
      .range([this.H - this.pad.b, this.pad.t]);
    return { data, x, y };
  });

  readonly pts = computed(() => {
    const { data, x, y } = this.scaled();
    return data.map((d) => ({
      label: d.label,
      cx: x(d.label) ?? 0,
      cy: y(d.value),
      leftPct: (((x(d.label) ?? 0) / this.W) * 100),
    }));
  });

  readonly linePath = computed(() => {
    const { data, x, y } = this.scaled();
    return (
      line<AreaPoint>()
        .x((d) => x(d.label) ?? 0)
        .y((d) => y(d.value))
        .curve(curveMonotoneX)(data) ?? ''
    );
  });

  readonly areaPath = computed(() => {
    const { data, x, y } = this.scaled();
    return (
      area<AreaPoint>()
        .x((d) => x(d.label) ?? 0)
        .y0(this.H - this.pad.b)
        .y1((d) => y(d.value))
        .curve(curveMonotoneX)(data) ?? ''
    );
  });
}
