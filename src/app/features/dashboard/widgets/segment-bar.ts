import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';

export interface Segment {
  label: string;
  value: number;
  color: string;
}

/**
 * Segment bar — the sweetag Pipeline idiom: a single rounded, segmented bar on
 * a soft track (one slice per category, min-width so tiny slices stay visible)
 * with a legend of dot · label · count · share beneath. Reads far cleaner than
 * a one-slice donut for a small categorical split.
 */
@Component({
  selector: 'sw-segment-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="track" role="img" [attr.aria-label]="ariaLabel">
      @for (s of view(); track s.label) {
        @if (s.value > 0) {
          <span class="seg" [style.width.%]="s.pct" [style.background]="s.color" [title]="s.label + ': ' + s.value"></span>
        }
      }
      @if (total() === 0) { <span class="seg empty"></span> }
    </div>
    <ul class="legend">
      @for (s of view(); track s.label) {
        <li>
          <span class="dot" [style.background]="s.color"></span>
          <span class="lbl">{{ s.label }}</span>
          <b>{{ s.value }}</b>
          <span class="pct">{{ s.pctLabel }}</span>
        </li>
      }
    </ul>
  `,
  styles: `
    :host { display: flex; flex-direction: column; }
    .track {
      display: flex; height: 14px; border-radius: var(--radius-pill); overflow: hidden;
      background: var(--surface-inset); margin-block-end: var(--space-5); flex: 0 0 auto;
    }
    .seg { height: 100%; min-width: 4px; transition: width .3s ease-out; }
    .seg.empty { width: 100%; background: var(--surface-inset); }
    .legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); flex: 1 1 auto; justify-content: space-around; }
    .legend li { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--text); }
    .dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; }
    .lbl { flex: 1; }
    .legend b { font-weight: 700; font-variant-numeric: tabular-nums; }
    .pct { width: 3.2rem; text-align: right; color: var(--text-dim); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  `,
})
export class SegmentBar {
  @Input() set data(v: Segment[]) {
    this._data.set(v ?? []);
  }
  @Input() ariaLabel = 'Segmented breakdown';

  private readonly _data = signal<Segment[]>([]);
  readonly total = computed(() => this._data().reduce((s, d) => s + d.value, 0));
  readonly view = computed(() => {
    const total = this.total();
    return this._data().map((s) => {
      const pct = total > 0 ? (s.value / total) * 100 : 0;
      return { ...s, pct, pctLabel: total > 0 ? `${Math.round(pct)}%` : '—' };
    });
  });
}
