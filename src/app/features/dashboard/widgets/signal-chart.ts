import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  computed,
  effect,
  signal,
  viewChild,
} from '@angular/core';
import {
  AreaSeries,
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';

export interface SignalPoint {
  time: UTCTimestamp;
  value: number;
}
export interface SignalStat {
  label: string;
  value: string;
  color?: string;
}

/**
 * Signal chart — the "embedded chart signal thing": TradingView
 * `lightweight-charts` (framework-agnostic, so it drops straight into Angular,
 * unlike React-only visx/recharts). Mirrors the sweetag Market-rates panel:
 * a filled AREA series + a comparison LINE series, transparent background,
 * crosshair, fit-to-content, auto-resizing. Fed a dense daily series so it
 * reads like a live market tape rather than a toy sparkline.
 */
@Component({
  selector: 'sw-signal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <div class="stats">
        @for (s of stats; track s.label) {
          <div class="stat">
            <span class="stat-label">
              @if (s.color) { <span class="swatch" [style.background]="s.color"></span> }
              {{ s.label }}
            </span>
            <span class="stat-value">{{ s.value }}</span>
          </div>
        }
      </div>
    </div>
    <div #host class="host"></div>
  `,
  styles: `
    :host { display: block; }
    .head { display: flex; justify-content: flex-end; margin-block-end: var(--space-3); }
    .stats { display: flex; flex-wrap: wrap; gap: var(--space-6); }
    .stat { text-align: right; }
    .stat-label { display: flex; align-items: center; gap: 6px; justify-content: flex-end; color: var(--text-dim); font-size: var(--text-xs); }
    .swatch { width: 8px; height: 8px; border-radius: 50%; }
    .stat-value { font-variant-numeric: tabular-nums; font-weight: 700; font-size: var(--text-sm); color: var(--text); }
    .host { width: 100%; height: 264px; }
  `,
})
export class SignalChart {
  @Input() set area(v: SignalPoint[]) {
    this._area.set(v ?? []);
  }
  @Input() set line(v: SignalPoint[]) {
    this._line.set(v ?? []);
  }
  @Input() stats: SignalStat[] = [];
  @Input() areaColor = '#3d7df2';
  @Input() lineColor = '#176b4d';

  private readonly host = viewChild<ElementRef<HTMLDivElement>>('host');
  private readonly _area = signal<SignalPoint[]>([]);
  private readonly _line = signal<SignalPoint[]>([]);
  private readonly data = computed(() => ({ area: this._area(), line: this._line() }));

  constructor() {
    effect((onCleanup) => {
      const el = this.host()?.nativeElement;
      const { area, line } = this.data();
      if (!el || (!area.length && !line.length)) return;

      const chart: IChartApi = createChart(el, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#6e726e',
          fontSize: 11,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: '#f0f1ec' },
          horzLines: { color: '#f0f1ec' },
        },
        rightPriceScale: { borderColor: '#eaebf0', scaleMargins: { top: 0.15, bottom: 0.1 } },
        timeScale: { borderColor: '#eaebf0' },
        crosshair: {
          horzLine: { labelBackgroundColor: '#172033' },
          vertLine: { labelBackgroundColor: '#172033' },
        },
        // Static tape: never capture the wheel (so page scroll passes through)
        // and no pan/zoom — the chart is a read-only signal, not a trading view.
        handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
        handleScale: { mouseWheel: false, pinch: false, axisPressedMouseMove: false, axisDoubleClickReset: false },
      });

      if (area.length) {
        const a = chart.addSeries(AreaSeries, {
          lineColor: this.areaColor,
          topColor: 'rgba(61, 125, 242, 0.25)',
          bottomColor: 'rgba(61, 125, 242, 0.02)',
          lineWidth: 2,
          priceLineVisible: false,
        });
        a.setData(area);
      }
      if (line.length) {
        const l = chart.addSeries(LineSeries, {
          color: this.lineColor,
          lineWidth: 2,
          priceLineVisible: false,
        });
        l.setData(line);
      }
      chart.timeScale().fitContent();

      onCleanup(() => chart.remove());
    });
  }
}
