import { ChangeDetectionStrategy, Component, Directive, Input, booleanAttribute } from '@angular/core';

/**
 * Standalone stand-ins for the admin console's `lj-*` UI primitives, with the
 * SAME selectors and slot names the live shell uses (scan §1 "Standard Page
 * Structure"), so feature templates transplant into the admin monorepo without
 * markup edits — over there these components already exist and ours are
 * deleted. Implementations here are intentionally minimal; they are NOT
 * pixel-clones, they honor the compositional contract:
 *
 *   <lj-page>
 *     <header header>
 *       <lj-box class="header" [padding]="4">
 *         <lj-box-row [paddingBlockEnd]="4">
 *           <h1 lj-page-heading>Title</h1>
 *           ... action bar (lj-button) ...
 */

@Component({
  selector: 'lj-page',
  template: `
    <ng-content select="[header]" />
    <div class="lj-page-body"><ng-content /></div>
  `,
  styles: `
    :host { display: block; min-height: 100%; }
    .lj-page-body {
      width: min(100%, 1240px); margin: 0 auto;
      padding: 0 clamp(1rem, 3vw, 3rem) clamp(3rem, 8vw, 7rem);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LjPage {}

@Component({
  selector: 'lj-box',
  template: `<ng-content />`,
  styles: `
    :host { display: block; }
    :host(.header) { background: transparent; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.padding]': 'pad' },
})
export class LjBox {
  // [padding]="4" → 16px, matching the admin app's 4px spacing scale.
  @Input() set padding(value: number | string) {
    this.pad = `${Number(value) * 4}px`;
  }
  protected pad = '0';
}

@Component({
  selector: 'lj-box-row',
  template: `<ng-content />`,
  styles: `
    :host { display: flex; align-items: center; gap: var(--space-3); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.paddingBlockEnd]': 'padEnd' },
})
export class LjBoxRow {
  @Input() set paddingBlockEnd(value: number | string) {
    this.padEnd = `${Number(value) * 4}px`;
  }
  protected padEnd = '0';
}

@Directive({
  selector: '[lj-page-heading]',
  host: { class: 'lj-page-heading' },
})
export class LjPageHeading {}

@Component({
  // Attribute selector on a real <button> keeps native semantics + a11y.
  selector: 'button[lj-button]',
  template: `<ng-content />`,
  host: {
    '[disabled]': 'disabled',
    '[attr.aria-disabled]': 'disabled ? "true" : null',
  },
  styles: `
    :host {
      min-height: 42px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      font: inherit; font-weight: 750; font-size: var(--text-sm);
      border-radius: var(--radius-pill); padding: 9px 16px; cursor: pointer;
      border: 1px solid var(--border); background: var(--surface); color: var(--text);
      transition: background var(--motion-fast) ease, border-color var(--motion-fast) ease, transform var(--motion-medium) var(--ease-settle);
    }
    :host(:hover:not(:disabled)) { background: var(--surface-hover); transform: translateY(-1px); }
    :host(:disabled) { opacity: 0.45; cursor: not-allowed; }
    :host(.primary) {
      background: var(--brand); border-color: var(--brand); color: var(--sweet-ink);
    }
    :host(.primary:hover:not(:disabled)) { background: var(--brand-hover); }
    :host(.danger) { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 28%, var(--border)); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LjButton {
  @Input({ transform: booleanAttribute }) disabled = false;
}

/** Import set for feature templates. */
export const LJ_PRIMITIVES = [LjPage, LjBox, LjBoxRow, LjPageHeading, LjButton] as const;
