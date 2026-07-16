import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';

export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
  /** Render with the unconfirmed (amber) badge — vocabulary confidence. */
  unconfirmed?: boolean;
}

/**
 * The WHEN/IF/THEN token: a pill that opens a searchable option panel.
 * Free-text entry (for text/numeric kinds) is enabled via `allowFreeText`;
 * `validateFreeText` returns an error string to block bad input inline
 * (numeric author-time validation — hardening C5 carried over).
 *
 * Self-contained dropdown (no CDK overlay): position: absolute under the pill,
 * closed on outside click / Escape. Swap for the admin repo's overlay pattern
 * if one exists there.
 */
@Component({
  selector: 'wf-token-picker',
  template: `
    <button
      type="button"
      class="pill"
      [class.open]="open()"
      [class.empty]="!label"
      [class.unconfirmed]="unconfirmed"
      (click)="toggle($event)"
    >
      <span class="pill-label">{{ label || placeholder }}</span>
      <span class="caret" aria-hidden="true">▾</span>
    </button>

    @if (open()) {
      <div class="panel" role="listbox">
        @if (searchable) {
          <input
            class="search"
            type="text"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
            (keydown.escape)="close()"
            placeholder="Search…"
            autofocus
          />
        }
        <div class="options">
          @for (option of filtered(); track option.value) {
            <button type="button" class="option" (click)="choose(option.value)">
              <span>{{ option.label }}</span>
              @if (option.unconfirmed) {
                <span class="badge">unconfirmed</span>
              }
              @if (option.hint) {
                <span class="hint">{{ option.hint }}</span>
              }
            </button>
          } @empty {
            <div class="none">No matches</div>
          }
        </div>
        @if (allowFreeText) {
          <form class="free" (submit)="submitFree($event)">
            <input
              class="search"
              type="text"
              [value]="freeText()"
              (input)="onFreeInput($any($event.target).value)"
              [placeholder]="freeTextPlaceholder"
            />
            @if (freeError()) {
              <div class="error">{{ freeError() }}</div>
            }
            <button type="submit" class="apply" [disabled]="!!freeError() || !freeText().trim()">
              Use value
            </button>
          </form>
        }
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-block; }
    .pill {
      display: inline-flex; align-items: center; gap: 6px;
      font: inherit; font-size: 13px; font-weight: 600;
      color: var(--text); background: var(--token-bg);
      border: 1px solid var(--token-border); border-radius: 999px;
      padding: 4px 12px; cursor: pointer; white-space: nowrap;
    }
    .pill:hover, .pill.open { border-color: var(--brand); }
    .pill.empty { color: var(--text-dim); border-style: dashed; font-weight: 500; }
    .pill.unconfirmed { border-color: var(--warn); }
    .caret { font-size: 10px; opacity: 0.6; }
    .panel {
      position: absolute; z-index: 30; top: calc(100% + 6px); left: 0;
      min-width: 240px; max-width: 340px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; box-shadow: 0 12px 32px rgb(0 0 0 / 0.14);
      padding: 8px; display: flex; flex-direction: column; gap: 8px;
    }
    .search {
      width: 100%; box-sizing: border-box; font: inherit; font-size: 13px;
      padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--surface-inset); color: var(--text); outline: none;
    }
    .search:focus { border-color: var(--brand); }
    .options { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; }
    .option {
      display: flex; align-items: center; gap: 8px; text-align: left;
      font: inherit; font-size: 13px; color: var(--text);
      background: none; border: 0; border-radius: 8px; padding: 8px 10px; cursor: pointer;
    }
    .option:hover { background: var(--surface-hover); }
    .badge {
      font-size: 10px; font-weight: 700; letter-spacing: 0.02em;
      color: var(--warn-text); background: var(--warn-bg);
      border-radius: 999px; padding: 1px 7px;
    }
    .hint { margin-left: auto; font-size: 11px; color: var(--text-dim); }
    .none { padding: 10px; font-size: 13px; color: var(--text-dim); }
    .free { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border); padding-top: 8px; }
    .error { font-size: 12px; color: var(--danger); }
    .apply {
      align-self: flex-end; font: inherit; font-size: 12px; font-weight: 600;
      background: var(--brand); color: #063a2e; border: 0; border-radius: 8px;
      padding: 6px 12px; cursor: pointer;
    }
    .apply:disabled { opacity: 0.45; cursor: not-allowed; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TokenPicker {
  @Input() label = '';
  @Input() placeholder = 'pick…';
  @Input() options: PickerOption[] = [];
  @Input() unconfirmed = false;
  @Input() allowFreeText = false;
  @Input() freeTextPlaceholder = 'Custom value…';
  @Input() validateFreeText: ((value: string) => string | null) | null = null;
  @Output() selected = new EventEmitter<string>();

  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly freeText = signal('');
  protected readonly freeError = signal<string | null>(null);

  get searchable(): boolean {
    return this.options.length > 7;
  }

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.options;
    return this.options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    );
  });

  toggle(event: Event) {
    event.stopPropagation();
    this.open.update((v) => !v);
    this.query.set('');
  }

  close() {
    this.open.set(false);
  }

  choose(value: string) {
    this.selected.emit(value);
    this.close();
  }

  protected onFreeInput(value: string) {
    this.freeText.set(value);
    this.freeError.set(this.validateFreeText ? this.validateFreeText(value) : null);
  }

  protected submitFree(event: Event) {
    event.preventDefault();
    const value = this.freeText().trim();
    if (!value || this.freeError()) return;
    this.freeText.set('');
    this.choose(value);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.close();
  }
}
