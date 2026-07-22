import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { hierarchy, treemap } from 'd3-hierarchy';

export interface TreeLeaf {
  name: string;
  value: number;
  color: string;
  subtitle?: string;
}

/**
 * Treemap — visx-style: `d3-hierarchy` lays out the rectangles, Angular renders
 * them. Area ∝ value (workflows sized by rule complexity). Each tile carries a
 * name + a breakdown subtitle and a subtle top-light gradient for depth.
 */
@Component({
  selector: 'sw-treemap',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="ariaLabel">
      <defs>
        <linearGradient id="tm-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0.16" />
          <stop offset="0.5" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
      </defs>
      @for (n of nodes(); track n.name) {
        <g [attr.transform]="'translate(' + n.x + ',' + n.y + ')'">
          <rect [attr.width]="n.w" [attr.height]="n.h" rx="10" [attr.fill]="n.color" />
          <rect [attr.width]="n.w" [attr.height]="n.h" rx="10" fill="url(#tm-sheen)" />
          @if (n.w > 64 && n.h > 34) {
            <text x="14" y="26" class="tm-name">{{ n.name }}</text>
            @if (n.subtitle && n.h > 54) { <text x="14" y="45" class="tm-sub">{{ n.subtitle }}</text> }
          }
        </g>
      }
    </svg>
  `,
  styles: `
    :host { display: block; }
    svg { display: block; width: 100%; height: auto; overflow: hidden; }
    .tm-name { font: 700 0.82rem var(--font-sans); fill: #fff; }
    .tm-sub { font: 500 0.66rem var(--font-sans); fill: rgba(255, 255, 255, 0.82); }
  `,
})
export class Treemap {
  @Input() set data(v: TreeLeaf[]) {
    this._data.set(v ?? []);
  }
  @Input() ariaLabel = 'Treemap';

  private readonly _data = signal<TreeLeaf[]>([]);
  readonly W = 520;
  readonly H = 260;

  readonly nodes = computed(() => {
    const leaves = this._data().filter((d) => d.value > 0);
    if (!leaves.length) return [];
    const root = hierarchy<{ name?: string; value?: number; color?: string; children?: TreeLeaf[] }>({
      children: leaves,
    }).sum((d) => (d as TreeLeaf).value ?? 0);
    treemap<{ name?: string; value?: number; color?: string }>()
      .size([this.W, this.H])
      .paddingInner(6)
      .round(true)(root as never);
    return root.leaves().map((n) => {
      const r = n as unknown as { x0: number; y0: number; x1: number; y1: number; data: TreeLeaf };
      return {
        name: r.data.name,
        subtitle: r.data.subtitle,
        color: r.data.color,
        x: r.x0,
        y: r.y0,
        w: r.x1 - r.x0,
        h: r.y1 - r.y0,
      };
    });
  });
}
