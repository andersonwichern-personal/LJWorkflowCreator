import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from '@angular/core';

@Component({
  selector: 'sweet-confirmation-dialog',
  template: `
    <dialog
      #dialog
      aria-labelledby="sweet-confirm-title"
      aria-describedby="sweet-confirm-description"
      (cancel)="onCancel($event)"
      (close)="closed()"
    >
      <button class="close" type="button" aria-label="Close dialog" (click)="cancelled.emit()">×</button>
      <p class="eyebrow">Please confirm</p>
      <h2 id="sweet-confirm-title">{{ title }}</h2>
      <p class="description" id="sweet-confirm-description">{{ description }}</p>
      <div class="actions">
        <button type="button" class="quiet" (click)="cancelled.emit()">Cancel</button>
        <button type="button" class="confirm" [class.danger]="danger" (click)="confirmed.emit()">
          {{ confirmLabel }}
        </button>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(31rem, calc(100vw - 2rem)); border: 0; border-radius: var(--radius-xl);
      padding: var(--space-8); color: var(--text); background: var(--surface);
      box-shadow: var(--shadow-dialog);
    }
    dialog::backdrop { background: rgb(17 19 21 / .38); backdrop-filter: blur(3px); }
    .close {
      position: absolute; inset: 1rem 1rem auto auto; width: 2.5rem; height: 2.5rem;
      border: 0; border-radius: 50%; background: transparent; color: var(--text-dim);
      font: inherit; font-size: 1.5rem; cursor: pointer;
    }
    .close:hover { background: var(--surface-inset); color: var(--text); }
    .eyebrow { margin: 0 0 var(--space-3); color: var(--brand-text); font-size: .72rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    h2 { margin: 0; max-width: 24rem; font-size: clamp(1.6rem, 4vw, 2.15rem); line-height: 1.08; letter-spacing: -.035em; }
    .description { margin: var(--space-4) 0 0; max-width: 27rem; color: var(--text-dim); line-height: 1.65; }
    .actions { display: flex; justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-8); }
    button.quiet, button.confirm { min-height: 2.75rem; padding: .7rem 1.1rem; border-radius: var(--radius-pill); border: 1px solid var(--border); font: inherit; font-weight: 750; cursor: pointer; }
    button.quiet { background: transparent; color: var(--text); }
    button.confirm { border-color: var(--brand); background: var(--brand); color: var(--sweet-ink); }
    button.confirm.danger { border-color: var(--danger); background: var(--danger); color: white; }
    @media (max-width: 480px) { dialog { padding: var(--space-6); } .actions { flex-direction: column-reverse; } .actions button { width: 100%; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmationDialog implements AfterViewInit {
  @ViewChild('dialog') private dialogRef?: ElementRef<HTMLDialogElement>;
  @Input() title = '';
  @Input() description = '';
  @Input() confirmLabel = 'Confirm';
  @Input() danger = false;
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  private shouldOpen = false;

  @Input() set open(value: boolean) {
    this.shouldOpen = value;
    this.syncDialog();
  }

  ngAfterViewInit() {
    this.syncDialog();
  }

  private syncDialog() {
    const dialog = this.dialogRef?.nativeElement;
    if (!dialog) return;
    if (this.shouldOpen && !dialog.open) dialog.showModal();
    if (!this.shouldOpen && dialog.open) dialog.close();
  }

  protected onCancel(event: Event) {
    event.preventDefault();
    this.cancelled.emit();
  }

  protected closed() {
    if (this.shouldOpen) this.cancelled.emit();
  }
}
