import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { max, min } from 'd3-array';
import { scaleLinear } from 'd3-scale';
import { curveMonotoneX, line } from 'd3-shape';

/**
 * Sparkline — the trailing mini-series inside a metric card (sweetag uses
 * recharts here; recharts is React-only, so this is the visx-style Angular
 * twin: `d3-shape` builds the path, the template renders it). Pure trend
 * shape, no axes.
 */
@Component({
  selector: 'sw-spark',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (path()) {
      <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" aria-hidden="true">
        <path [attr.d]="path()" fill="none" [attr.stroke]="color" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
      </svg>
    }
  `,
  styles: `
    :host { display: block; width: 80px; height: 32px; }
    svg { display: block; width: 100%; height: 100%; }
  `,
})
export class Sparkline {
  @Input() set data(v: number[]) {
    this._data.set(v ?? []);
  }
  @Input() color = 'var(--brand)';

  private readonly _data = signal<number[]>([]);
  readonly W = 80;
  readonly H = 32;

  readonly path = computed(() => {
    const d = this._data();
    if (d.length < 2) return '';
    const x = scaleLinear().domain([0, d.length - 1]).range([1, this.W - 1]);
    const y = scaleLinear()
      .domain([min(d) ?? 0, max(d) ?? 1])
      .range([this.H - 2, 2]);
    return line<number>().x((_, i) => x(i)).y((v) => y(v)).curve(curveMonotoneX)(d) ?? '';
  });
}
