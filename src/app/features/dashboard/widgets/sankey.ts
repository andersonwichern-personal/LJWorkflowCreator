import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';

export interface SankeyNodeIn {
  name: string;
  color?: string;
}
export interface SankeyLinkIn {
  source: number;
  target: number;
  value: number;
}
export interface SankeyInput {
  nodes: SankeyNodeIn[];
  links: SankeyLinkIn[];
}

/**
 * Sankey — visx has no sankey package, so (exactly like apps/web) `d3-sankey`
 * computes the layout and the framework renders the SVG. Flow of one category
 * into another, e.g. triggers → actions.
 */
@Component({
  selector: 'sw-sankey',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="ariaLabel">
      @for (l of graph().links; track $index) {
        <path
          [attr.d]="l.path"
          fill="none"
          [attr.stroke]="l.color"
          [attr.stroke-width]="l.width"
          stroke-opacity="0.4" />
      }
      @for (n of graph().nodes; track n.name) {
        <rect [attr.x]="n.x0" [attr.y]="n.y0" [attr.width]="n.x1 - n.x0" [attr.height]="n.y1 - n.y0"
          rx="2" [attr.fill]="n.color" />
        <text
          [attr.x]="n.labelX" [attr.y]="(n.y0 + n.y1) / 2" [attr.text-anchor]="n.anchor"
          dy="0.35em" class="sk-label">{{ n.name }}</text>
      }
    </svg>
  `,
  styles: `
    :host { display: flex; flex-direction: column; justify-content: center; }
    svg { display: block; width: 100%; height: auto; overflow: visible; }
    .sk-label { font: 600 0.62rem var(--font-sans); fill: var(--text); }
  `,
})
export class SankeyChart {
  @Input() set data(v: SankeyInput) {
    this._input.set(v ?? { nodes: [], links: [] });
  }
  @Input() ariaLabel = 'Sankey flow';

  private readonly _input = signal<SankeyInput>({ nodes: [], links: [] });
  readonly W = 520;
  readonly H = 260;

  readonly graph = computed(() => {
    const input = this._input();
    if (!input.nodes.length || !input.links.length) return { nodes: [], links: [] };

    const gen = sankey<Record<string, unknown>, Record<string, unknown>>()
      .nodeWidth(14)
      .nodePadding(16)
      .extent([
        [1, 8],
        [this.W - 1, this.H - 8],
      ]);
    const laid = gen({
      nodes: input.nodes.map((d) => ({ ...d })),
      links: input.links.map((d) => ({ ...d })),
    });
    const linkPath = sankeyLinkHorizontal();

    const nodes = laid.nodes.map((n) => {
      const node = n as { name: string; color?: string; x0: number; y0: number; x1: number; y1: number };
      const left = node.x0 < this.W / 2;
      return {
        name: node.name,
        color: node.color ?? 'var(--brand)',
        x0: node.x0,
        y0: node.y0,
        x1: node.x1,
        y1: node.y1,
        anchor: left ? 'start' : 'end',
        labelX: left ? node.x1 + 6 : node.x0 - 6,
      };
    });
    const links = laid.links.map((l) => {
      const link = l as { width?: number; source: { color?: string } };
      return {
        path: linkPath(l as never) ?? '',
        width: Math.max(1, link.width ?? 1),
        color: link.source.color ?? 'var(--brand)',
      };
    });
    return { nodes, links };
  });
}
