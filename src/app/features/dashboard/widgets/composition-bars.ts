import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';

export interface CompositionItem {
  name: string;
  triggers: number;
  actions: number;
}

/**
 * Composition bars — a ranked, stacked horizontal bar per workflow. Bar length
 * encodes total rule complexity (triggers + actions); the internal split shows
 * the makeup (triggers vs actions). Replaces the treemap, which only reads well
 * with many differently-sized items — a handful of similar workflows just drew
 * flat blocks.
 */
@Component({
  selector: 'sw-composition-bars',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legend">
      <span><span class="dot t"></span>Triggers</span>
      <span><span class="dot a"></span>Actions</span>
    </div>
    <ul class="rows">
      @for (r of rows(); track r.name) {
        <li>
          <span class="name" [title]="r.name">{{ r.name }}</span>
          <span class="stack">
            @if (r.triggers > 0) { <span class="seg t" [style.width.%]="r.tPct" [title]="r.triggers + ' triggers'"></span> }
            @if (r.actions > 0) { <span class="seg a" [style.width.%]="r.aPct" [title]="r.actions + ' actions'"></span> }
          </span>
          <span class="meta">
            <span class="pill">{{ r.total }} {{ r.total === 1 ? 'rule' : 'rules' }}</span>
          </span>
        </li>
      }
    </ul>
  `,
  styles: `
    :host { display: flex; flex-direction: column; }
    .legend { display: flex; gap: var(--space-4); margin-block-end: var(--space-4); color: var(--text-dim); font-size: var(--text-xs); flex: 0 0 auto; }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot.t { background: var(--accent); }
    .dot.a { background: var(--brand); }
    .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-4); flex: 1 1 auto; justify-content: space-around; }
    li { display: grid; grid-template-columns: 11rem 1fr auto; gap: var(--space-3); align-items: center; }
    .name { font-size: var(--text-sm); font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .stack { display: flex; height: 22px; border-radius: var(--radius-pill); background: var(--surface-inset); overflow: hidden; }
    .seg { height: 100%; min-width: 4px; transition: width .35s ease-out; }
    .seg.t { background: var(--accent); }
    .seg.a { background: var(--brand); }
    .meta { justify-self: end; }
    .pill {
      padding: 2px 10px; border-radius: var(--radius-pill); background: var(--surface-inset);
      color: var(--text); font-size: var(--text-xs); font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap;
    }
  `,
})
export class CompositionBars {
  @Input() set data(v: CompositionItem[]) {
    this._data.set(v ?? []);
  }

  private readonly _data = signal<CompositionItem[]>([]);
  readonly rows = computed(() => {
    const items = this._data().map((d) => ({ ...d, total: d.triggers + d.actions }));
    const maxTotal = Math.max(1, ...items.map((i) => i.total));
    return items
      .sort((a, b) => b.total - a.total)
      .map((i) => ({
        ...i,
        tPct: (i.triggers / maxTotal) * 100,
        aPct: (i.actions / maxTotal) * 100,
      }));
  });
}
