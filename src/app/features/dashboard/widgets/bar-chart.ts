import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { max } from 'd3-array';
import { scaleLinear } from 'd3-scale';

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

/**
 * Horizontal bars — visx-style: `d3-scale` maps values → widths, the template
 * renders the rows as HTML (crisper text + a value chip + share % than an SVG
 * viewBox that scales its own type). Reusable "count by category" widget.
 */
@Component({
  selector: 'sw-bars',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="rows" role="img" [attr.aria-label]="ariaLabel">
      @for (b of bars(); track b.label) {
        <li>
          <span class="label" [title]="b.label">{{ b.label }}</span>
          <span class="track">
            <span class="fill" [style.width.%]="b.pct" [style.background]="b.color ?? barColor"></span>
          </span>
          <span class="value">{{ b.value }}</span>
          <span class="share">{{ b.share }}</span>
        </li>
      }
    </ul>
  `,
  styles: `
    :host { display: flex; flex-direction: column; }
    .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-4); max-width: 640px; flex: 1 1 auto; justify-content: space-around; }
    li { display: grid; grid-template-columns: 9.5rem 1fr auto 3rem; align-items: center; gap: var(--space-3); }
    .label { font-size: var(--text-sm); font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .track { height: 12px; border-radius: var(--radius-pill); background: var(--surface-inset); overflow: hidden; }
    .fill { display: block; height: 100%; border-radius: var(--radius-pill); min-width: 6px; transition: width .35s ease-out; }
    .value {
      justify-self: end; min-width: 1.6rem; text-align: center; padding: 1px 8px; border-radius: var(--radius-pill);
      background: var(--surface-inset); color: var(--text); font-size: var(--text-xs); font-weight: 700; font-variant-numeric: tabular-nums;
    }
    .share { justify-self: end; color: var(--text-dim); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  `,
})
export class BarChart {
  @Input() set data(v: BarDatum[]) {
    this._data.set(v ?? []);
  }
  @Input() ariaLabel = 'Bar chart';
  @Input() barColor = 'var(--brand)';

  private readonly _data = signal<BarDatum[]>([]);

  readonly bars = computed(() => {
    const data = this._data();
    const total = data.reduce((s, d) => s + d.value, 0);
    const x = scaleLinear().domain([0, max(data, (d) => d.value) || 1]).range([0, 100]);
    return data.map((d) => ({
      ...d,
      pct: Math.max(d.value > 0 ? 4 : 0, x(d.value)),
      share: total > 0 ? `${Math.round((d.value / total) * 100)}%` : '—',
    }));
  });
}
