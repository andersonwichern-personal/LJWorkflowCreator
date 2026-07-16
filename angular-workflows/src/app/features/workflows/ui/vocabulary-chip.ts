import { ChangeDetectionStrategy, Component, Injectable, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiService } from '../../../shared/api.service';
import { APP_CONFIG, isMockMode } from '../../../shared/app-config';

/**
 * Live-vocabulary seam (demo-bridge doctrine: fetched, not hardcoded).
 *
 * When credentials are configured, pulls the three confirmed vocabulary
 * sources through the production header contract:
 *   documents:/templates/forms · products:/fields?search= · workflows:/templates
 * and reports per-source counts. Static fallback otherwise — the builder's
 * pickers currently consume the static vocabulary either way; overlaying live
 * options into the pickers is the NEXT increment (ledger), this service is the
 * transport + status truth.
 */
@Injectable({ providedIn: 'root' })
export class VocabularyService {
  private readonly api = inject(ApiService);
  private readonly config = inject(APP_CONFIG);

  readonly source = signal<'static' | 'live' | 'partial'>('static');
  readonly detail = signal('Demo vocabulary — configure APP_CONFIG for live tenant data.');

  constructor() {
    if (!isMockMode(this.config)) this.probe();
  }

  private probe() {
    const count = (service: string, path: string) =>
      this.api.get<unknown[]>(service, path).pipe(
        map((rows) => (Array.isArray(rows) ? rows.length : 0)),
        catchError(() => of(-1))
      );
    forkJoin({
      forms: count('documents', '/templates/forms'),
      fields: count('products', '/fields?search='),
      templates: count('workflows', '/templates'),
    }).subscribe(({ forms, fields, templates }) => {
      const parts = [
        forms >= 0 ? `${forms} forms` : 'forms unavailable',
        fields >= 0 ? `${fields} fields` : 'fields unavailable',
        templates >= 0 ? `${templates} templates` : 'templates unavailable',
      ];
      const failures = [forms, fields, templates].filter((n) => n < 0).length;
      this.source.set(failures === 0 ? 'live' : failures === 3 ? 'static' : 'partial');
      this.detail.set(parts.join(' · '));
    });
  }
}

@Component({
  selector: 'wf-vocabulary-chip',
  template: `
    <span class="chip" [class.live]="vocab.source() === 'live'" [title]="vocab.detail()">
      {{ vocab.source() === 'live' ? '● Live vocabulary' : vocab.source() === 'partial' ? '◐ Partial vocabulary' : '○ Demo vocabulary' }}
    </span>
  `,
  styles: `
    .chip {
      font-size: 11px; font-weight: 700; letter-spacing: 0.02em;
      border-radius: 999px; padding: 3px 12px; cursor: default;
      background: var(--surface-inset); color: var(--text-dim);
    }
    .chip.live { background: color-mix(in srgb, var(--brand) 15%, transparent); color: var(--brand-text); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VocabularyChip {
  protected readonly vocab = inject(VocabularyService);
}
