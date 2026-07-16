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
    .lj-page-body { padding: 0 24px 32px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LjPage {}

@Component({
  selector: 'lj-box',
  template: `<ng-content />`,
  styles: `
    :host { display: block; }
    :host(.header) { background: var(--surface); border-bottom: 1px solid var(--border); }
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
    :host { display: flex; align-items: center; gap: 12px; }
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
  styles: `
    :host {
      display: inline-flex; align-items: center; gap: 6px;
      font: inherit; font-weight: 600; font-size: 13px;
      border-radius: 8px; padding: 8px 14px; cursor: pointer;
      border: 1px solid var(--border); background: var(--surface); color: var(--text);
      transition: background 120ms ease, border-color 120ms ease;
    }
    :host(:hover:not(:disabled)) { background: var(--surface-hover); }
    :host(:disabled) { opacity: 0.45; cursor: not-allowed; }
    :host(.primary) {
      background: var(--brand); border-color: var(--brand); color: #063a2e;
    }
    :host(.primary:hover:not(:disabled)) { background: var(--brand-hover); }
    :host(.danger) { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LjButton {
  @Input({ transform: booleanAttribute }) disabled = false;
}

/** Import set for feature templates. */
export const LJ_PRIMITIVES = [LjPage, LjBox, LjBoxRow, LjPageHeading, LjButton] as const;
