import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
} from '@angular/core';
import { SWEET_SPIRAL_STATUS, SweetSpiralState } from './sweet-spiral.state';

/** Exact-geometry extraction of the 61 authored circles in the Sweet mark. */
@Component({
  selector: 'wf-sweet-spiral',
  template: `
    <div
      class="spiral-stage"
      [attr.data-state]="state"
      [attr.data-status]="status"
      aria-hidden="true"
      (pointerenter)="pointerEnter()"
      (pointermove)="pointerMove($event)"
      (pointerleave)="pointerLeave()"
    >
      <div class="halo"></div>
      <div class="emblem-plane">
        <svg viewBox="37.62 38.79 874.05 923.74" role="presentation" focusable="false">
          <g transform="rotate(180 474.645 500.66)">
            <g class="particle-field">
              <circle cx="435.5" cy="44.85" r="5.06" fill="#4b4d4f" />
              <circle cx="570.52" cy="54" r="6.61" fill="#111315" />
              <circle cx="307.38" cy="81.94" r="1.87" fill="#5b5d5f" />
              <circle cx="697.12" cy="112.02" r="8.76" fill="#111315" />
              <circle cx="407.31" cy="152.81" r="9.18" fill="#111315" />
              <circle cx="511.42" cy="162.32" r="12.05" fill="#111315" />
              <circle cx="193.31" cy="155.88" r="2.5" fill="#5b5d5f" />
              <circle cx="308.14" cy="179.08" r="6.61" fill="#111315" />
              <circle cx="607.76" cy="206.64" r="13.44" fill="#111315" />
              <circle cx="799.26" cy="207.83" r="10.79" fill="#111315" />
              <circle cx="222.13" cy="236.69" r="5.54" fill="#111315" />
              <circle cx="392.45" cy="253.81" r="12.76" fill="#111315" />
              <circle cx="466.55" cy="263.06" r="13.57" fill="#111315" />
              <circle cx="107.28" cy="261.65" r="1.93" fill="#5b5d5f" />
              <circle cx="317.83" cy="270.14" r="10.33" fill="#111315" />
              <circle cx="684.37" cy="280.53" r="14.66" fill="#111315" />
              <circle cx="532.81" cy="296.54" r="14.64" fill="#111315" />
              <circle cx="251.37" cy="307.75" r="9.04" fill="#111315" />
              <circle cx="864.68" cy="319.55" r="11.82" fill="#111315" />
              <circle cx="155.97" cy="317.51" r="4.92" fill="#4b4d4f" />
              <circle cx="583.43" cy="344.95" r="15.49" fill="#111315" />
              <circle cx="733.58" cy="366.27" r="15.51" fill="#111315" />
              <circle cx="201.87" cy="360.31" r="8.32" fill="#111315" />
              <circle cx="54.85" cy="388.35" r="1.67" fill="#5b5d5f" />
              <circle cx="619.16" cy="407.16" r="15.27" fill="#111315" />
              <circle cx="116.24" cy="410.85" r="4.52" fill="#4b4d4f" />
              <circle cx="169.68" cy="429.92" r="7.74" fill="#111315" />
              <circle cx="897.63" cy="443.13" r="12.33" fill="#111315" />
              <circle cx="758.13" cy="460.01" r="16.27" fill="#111315" />
              <circle cx="638.24" cy="474.77" r="15.69" fill="#111315" />
              <circle cx="155.9" cy="507.12" r="7.23" fill="#111315" />
              <circle cx="101.4" cy="507.27" r="3.89" fill="#5b5d5f" />
              <circle cx="40.29" cy="507.77" r="1.67" fill="#5b5d5f" />
              <circle cx="638.51" cy="543.02" r="15.61" fill="#111315" />
              <circle cx="759.33" cy="555.28" r="15.91" fill="#111315" />
              <circle cx="897.9" cy="569.18" r="12.77" fill="#111315" />
              <circle cx="165.97" cy="582.79" r="7.76" fill="#111315" />
              <circle cx="621.14" cy="608" r="15.51" fill="#111315" />
              <circle cx="114.45" cy="606.55" r="4.03" fill="#5b5d5f" />
              <circle cx="736.46" cy="647.45" r="15.41" fill="#111315" />
              <circle cx="198.05" cy="653.54" r="6.97" fill="#4b4d4f" />
              <circle cx="586.16" cy="669.7" r="14.65" fill="#111315" />
              <circle cx="866.91" cy="693.34" r="11.99" fill="#111315" />
              <circle cx="154.31" cy="692.98" r="3.48" fill="#5b5d5f" />
              <circle cx="249.4" cy="707.39" r="7.59" fill="#111315" />
              <circle cx="536.12" cy="716.15" r="13.94" fill="#111315" />
              <circle cx="685.82" cy="733.5" r="13.91" fill="#111315" />
              <circle cx="315.53" cy="743.17" r="8.58" fill="#111315" />
              <circle cx="467.45" cy="750.27" r="12.41" fill="#111315" />
              <circle cx="107.28" cy="747.3" r="1.8" fill="#5b5d5f" />
              <circle cx="391.9" cy="759.13" r="10.34" fill="#111315" />
              <circle cx="222.63" cy="775.48" r="4.89" fill="#4b4d4f" />
              <circle cx="608.61" cy="802.12" r="12.37" fill="#111315" />
              <circle cx="799.87" cy="806.41" r="9.7" fill="#111315" />
              <circle cx="306.42" cy="829.61" r="6.41" fill="#4b4d4f" />
              <circle cx="512.83" cy="846.51" r="9.53" fill="#111315" />
              <circle cx="406.73" cy="854.5" r="8.34" fill="#111315" />
              <circle cx="695.82" cy="899.06" r="8.27" fill="#111315" />
              <circle cx="569.7" cy="950.93" r="5.8" fill="#4b4d4f" />
              <circle cx="435.27" cy="957.64" r="3.89" fill="#5b5d5f" />
            </g>
            <circle class="pulse-ring" cx="380.75" cy="508.68" r="82.96" />
            <circle class="focal-point" cx="380.75" cy="508.68" r="82.96" fill="#3d7df2" />
          </g>
        </svg>
      </div>
    </div>
  `,
  styles: `
    :host {
      --sweet-tilt-x: 0deg; --sweet-tilt-y: 0deg; --sweet-turn: 0deg;
      --sweet-parallax-x: 0px; --sweet-parallax-y: 0px; --sweet-energy: 0;
      display: block; width: 100%; aspect-ratio: 1;
    }
    .spiral-stage {
      position: relative; width: 100%; height: 100%; display: grid; place-items: center;
      perspective: 900px; isolation: isolate;
    }
    .halo {
      position: absolute; inset: 16%; border-radius: 50%; opacity: .22;
      background: radial-gradient(circle, rgb(61 125 242 / .19), transparent 68%);
      filter: blur(28px); transform: scale(calc(1 + var(--sweet-energy) * .08));
      transition: opacity var(--motion-slow) var(--ease-standard);
    }
    .emblem-plane {
      width: 100%; height: 100%; transform-style: preserve-3d;
      transform: rotateX(var(--sweet-tilt-x)) rotateY(var(--sweet-tilt-y));
      transition: transform var(--motion-slow) var(--ease-settle);
      will-change: transform;
    }
    svg {
      display: block; width: 100%; height: 100%; overflow: visible;
      transform: rotate(var(--sweet-turn)) scale(calc(1 + var(--sweet-energy) * .025));
      transform-origin: center; transition: transform var(--motion-medium) var(--ease-settle);
      will-change: transform;
    }
    .particle-field {
      transform: translate(var(--sweet-parallax-x), var(--sweet-parallax-y));
      transform-origin: center; animation: breathe 13s ease-in-out infinite alternate;
      will-change: transform, opacity;
    }
    .focal-point {
      transform-box: fill-box; transform-origin: center;
      transform: scale(calc(1 + var(--sweet-energy) * .07));
      transition: fill var(--motion-medium) var(--ease-standard), opacity var(--motion-medium) ease;
      will-change: transform;
    }
    .pulse-ring {
      fill: none; stroke: #3d7df2; stroke-width: 5; opacity: 0;
      transform-box: fill-box; transform-origin: center;
    }
    [data-state='focused'] .focal-point,
    [data-state='typing'] .focal-point { filter: drop-shadow(0 0 24px rgb(61 125 242 / .22)); }
    [data-state='submitted'] .pulse-ring { animation: receive 520ms var(--ease-settle) both; }
    [data-state='parsing'] .particle-field { animation: organize 2.4s var(--ease-standard) infinite; }
    [data-state='parsing'] svg { animation: purpose 4s linear infinite; }
    [data-state='clarification'] .particle-field { animation: consider 2.8s ease-in-out infinite; }
    [data-state='partial'] .particle-field { animation: unresolved 4.2s ease-in-out infinite; opacity: .82; }
    [data-state='understood'] .focal-point { animation: understood 760ms var(--ease-settle) both; }
    [data-state='parser-error'] .particle-field { animation-play-state: paused; opacity: .58; }
    [data-state='network-error'] .particle-field { animation-duration: 24s; opacity: .7; }
    @keyframes breathe { from { transform: translate(var(--sweet-parallax-x), var(--sweet-parallax-y)) scale(.992); } to { transform: translate(var(--sweet-parallax-x), var(--sweet-parallax-y)) scale(1.008); } }
    @keyframes receive { 0% { opacity: 0; transform: scale(.7); } 35% { opacity: .65; } 100% { opacity: 0; transform: scale(1.65); } }
    @keyframes organize { 0%, 100% { transform: translate(var(--sweet-parallax-x), var(--sweet-parallax-y)) scale(.99); } 50% { transform: translate(var(--sweet-parallax-x), var(--sweet-parallax-y)) scale(1.012); } }
    @keyframes purpose { to { transform: rotate(calc(var(--sweet-turn) + 360deg)); } }
    @keyframes consider { 0%,100% { transform: translateX(-3px); } 50% { transform: translateX(3px); } }
    @keyframes unresolved { 0%,100% { transform: rotate(-.5deg); } 50% { transform: rotate(.5deg); } }
    @keyframes understood { 0% { transform: scale(1); } 45% { transform: scale(1.14); } 100% { transform: scale(1); } }
    @media (hover: none), (pointer: coarse) {
      .emblem-plane { transform: none; }
      .particle-field { animation-duration: 18s; }
    }
    @media (prefers-reduced-motion: reduce) {
      .emblem-plane, svg, .particle-field, .focal-point, .pulse-ring, .halo {
        animation: none !important; transform: none !important; transition-duration: 1ms !important;
      }
      [data-state='focused'] .focal-point,
      [data-state='typing'] .focal-point,
      [data-state='understood'] .focal-point { filter: drop-shadow(0 0 12px rgb(61 125 242 / .22)); }
      [data-state='partial'] .particle-field,
      [data-state='parser-error'] .particle-field { opacity: .62; }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SweetSpiral implements OnChanges, OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly finePointer =
    typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  private readonly reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  @Input() state: SweetSpiralState = 'idle';
  @Input() typingPulse = 0;

  private targetX = 0;
  private targetY = 0;
  private currentX = 0;
  private currentY = 0;
  private energy = 0;
  private frame: number | null = null;
  private bounds: DOMRect | null = null;

  protected get status() {
    return SWEET_SPIRAL_STATUS[this.state];
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['typingPulse'] && !changes['typingPulse'].firstChange && !this.reducedMotion) {
      this.energy = Math.min(1, this.energy + 0.18);
      this.requestFrame();
    }
  }

  protected pointerEnter() {
    if (this.finePointer && !this.reducedMotion) {
      // Cache the only layout read for the pointer session. Pointermove then
      // updates composited CSS properties without forcing repeated layout.
      this.bounds = this.host.nativeElement.getBoundingClientRect();
      this.requestFrame();
    }
  }

  protected pointerMove(event: PointerEvent) {
    if (!this.finePointer || this.reducedMotion) return;
    const rect = this.bounds ?? this.host.nativeElement.getBoundingClientRect();
    this.targetX = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
    this.targetY = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
    this.requestFrame();
  }

  protected pointerLeave() {
    this.bounds = null;
    this.targetX = 0;
    this.targetY = 0;
    if (!this.reducedMotion) this.requestFrame();
  }

  private requestFrame() {
    if (this.frame === null) this.frame = requestAnimationFrame(() => this.animate());
  }

  private animate() {
    this.frame = null;
    this.currentX += (this.targetX - this.currentX) * 0.09;
    this.currentY += (this.targetY - this.currentY) * 0.09;
    this.energy *= 0.9;

    const style = this.host.nativeElement.style;
    style.setProperty('--sweet-tilt-x', `${(-this.currentY * 4).toFixed(2)}deg`);
    style.setProperty('--sweet-tilt-y', `${(this.currentX * 6).toFixed(2)}deg`);
    style.setProperty('--sweet-turn', `${(this.currentX * 4 + this.energy * 2).toFixed(2)}deg`);
    style.setProperty('--sweet-parallax-x', `${(this.currentX * 4).toFixed(2)}px`);
    style.setProperty('--sweet-parallax-y', `${(this.currentY * 4).toFixed(2)}px`);
    style.setProperty('--sweet-energy', this.energy.toFixed(3));

    const moving =
      Math.abs(this.targetX - this.currentX) > 0.002 ||
      Math.abs(this.targetY - this.currentY) > 0.002 ||
      this.energy > 0.005;
    if (moving) this.requestFrame();
  }

  ngOnDestroy() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
  }
}
