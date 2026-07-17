import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { ApiService } from '../../../shared/api.service';
import { APP_CONFIG, isMockMode } from '../../../shared/app-config';
import { CacheService } from '../../../shared/cache.service';
import { PickerOption } from './token-picker';

/** Stale-while-revalidate cache for the vocabulary probe (B2). */
const VOCAB_CACHE_KEY = 'workflowVocabCache';
const VOCAB_CACHE_TTL_MS = 5 * 60 * 1000;

interface VocabSnapshot {
  at: number;
  users: PickerOption[];
  retailers: PickerOption[];
  fields: PickerOption[];
  fieldsRaw: any[];
  stages: PickerOption[];
  templates: PickerOption[];
  templateIds: string[];
  productFields: PickerOption[];
}

interface Row {
  [key: string]: any;
}

function idOf(r: Row, fallback: string): string {
  return (
    ['id', 'uuid', 'userId', 'user_id']
      .map((k) => r[k])
      .find((v): v is string => typeof v === 'string' && v.length > 0) || fallback
  );
}

function nameOf(r: Row): string {
  const raw =
    ['name', 'label', 'displayName', 'display_name', 'firstName', 'first_name', 'fullName', 'full_name']
      .map((k) => r[k])
      .find((v): v is string => typeof v === 'string' && v.length > 0) || '';
  if (raw) return raw;
  const first = typeof r['firstName'] === 'string' ? r['firstName'] : '';
  const last = typeof r['lastName'] === 'string' ? r['lastName'] : '';
  if (first || last) return `${first} ${last}`.trim();
  return '';
}

function extractArray(val: unknown): Row[] {
  if (Array.isArray(val)) return val as Row[];
  if (val && typeof val === 'object') {
    const o = val as Row;
    for (const key of ['items', 'rows', 'data', 'users', 'retailers', 'templates', 'forms']) {
      if (Array.isArray(o[key])) return o[key] as Row[];
    }
  }
  return [];
}

function toOptions(rows: Row[]): PickerOption[] {
  return rows.flatMap((row) => {
    const name = nameOf(row);
    if (!name) return [];
    return [{ value: idOf(row, name), label: name }];
  });
}

function toTemplates(rows: Row[]): any[] {
  return rows.flatMap((row) => {
    const name = nameOf(row);
    if (!name) return [];
    const rawStages = Array.isArray(row.stages) ? (row.stages as Row[]) : [];
    const requestType = ['requestType', 'request_type', 'type']
      .map((k) => row[k])
      .find((v): v is string => typeof v === 'string' && v.length > 0);
    return [{ id: idOf(row, name), name, requestType, stages: toOptions(rawStages) }];
  });
}

function toLiveFields(raw: unknown, formTemplateId: string, formName: string): any[] {
  let sections: Row[] = [];
  if (Array.isArray(raw)) {
    sections = raw as Row[];
  } else if (raw && typeof raw === 'object') {
    const o = raw as Row;
    for (const key of ['sections', 'definition', 'formDefinition', 'form_definition', 'template']) {
      if (Array.isArray(o[key])) {
        sections = o[key] as Row[];
        break;
      }
    }
    if (!sections.length) {
      try {
        sections = extractArray(raw);
      } catch {
        sections = [];
      }
    }
  }
  if (sections.some((s) => typeof s['fieldType'] === 'string')) {
    sections = [{ fields: sections } as Row];
  }
  return sections.flatMap((section) => {
    const fields = Array.isArray(section['fields']) ? (section['fields'] as Row[]) : [];
    return fields.flatMap((f) => {
      const fieldId = typeof f['id'] === 'string' ? f['id'] : null;
      const fieldType = typeof f['fieldType'] === 'string' ? f['fieldType'] : null;
      if (!fieldId || !fieldType) return [];
      return [
        {
          formTemplateId,
          formName,
          fieldId,
          name: typeof f['name'] === 'string' ? f['name'] : fieldId,
          label: typeof f['label'] === 'string' && f['label'] ? f['label'] : (f['name'] as string) ?? fieldId,
          fieldType,
          required: Boolean(f['required']),
        },
      ];
    });
  });
}

/**
 * Live-vocabulary seam (demo-bridge doctrine: fetched, not hardcoded).
 *
 * When credentials are configured, pulls live users, retailers, templates,
 * forms, anddynamic fields through the production header contract and stores
 * them in Signals for builder pickers.
 */
@Injectable({ providedIn: 'root' })
export class VocabularyService {
  private readonly api = inject(ApiService);
  private readonly config = inject(APP_CONFIG);
  private readonly cache = inject(CacheService);

  readonly source = signal<'static' | 'live' | 'partial'>('static');
  readonly detail = signal('Demo vocabulary — configure APP_CONFIG for live tenant data.');

  // Live options registers for picker overlays
  readonly liveUsers = signal<PickerOption[]>([]);
  readonly liveRetailers = signal<PickerOption[]>([]);
  readonly liveFields = signal<PickerOption[]>([]);
  readonly liveFieldsRaw = signal<any[]>([]);
  readonly liveStages = signal<PickerOption[]>([]);
  readonly liveTemplates = signal<PickerOption[]>([]);
  /**
   * Real request-template ids from `workflows /templates` — the linter's
   * `templates` registry. Distinct from `liveTemplates`, which the pickers
   * populate with FORMS (see probe note below).
   */
  readonly liveTemplateIds = signal<string[]>([]);
  /**
   * Product fields from `products /fields` (task.md-confirmed source).
   * Surfaced for visibility only — binding them as condition operands needs a
   * rule-core field-ref kind first (schema change, packages/rule-core).
   */
  readonly liveProductFields = signal<PickerOption[]>([]);

  constructor() {
    if (!isMockMode(this.config)) {
      // Stale-while-revalidate: paint from a fresh-enough snapshot instantly,
      // then probe in the background to refresh it.
      const snap = this.cache.read<VocabSnapshot>(VOCAB_CACHE_KEY);
      if (snap && Date.now() - snap.at < VOCAB_CACHE_TTL_MS) this.apply(snap);
      this.probe();
    }
  }

  private fetchSessionOrgId(): Observable<string | null> {
    return this.api.get<Row>('iam', '/users/me').pipe(
      map((me) => {
        for (const key of ['orgId', 'organizationId', 'organization_id', 'org_id']) {
          if (typeof me[key] === 'string' && me[key]) return me[key] as string;
        }
        const org = me['organization'] as Row | undefined;
        if (org && typeof org['id'] === 'string') return org['id'];
        const orgs = me['organizations'] as Row[] | undefined;
        if (Array.isArray(orgs) && orgs[0] && typeof orgs[0]['id'] === 'string') return orgs[0]['id'];
        return null;
      }),
      catchError(() => of(null))
    );
  }

  private probe() {
    this.fetchSessionOrgId()
      .pipe(
        switchMap((orgId) => {
          if (!orgId) {
            return of({
              users: [] as Row[],
              retailers: [] as Row[],
              templates: [] as Row[],
              forms: [] as Row[],
              fields: [] as any[],
              productFields: [] as Row[],
            });
          }
          const usersObs = this.api
            .get<unknown>('iam', `/organizations/${orgId}/users?page=0&groups=EMPLOYEES&include_disabled=false&page_size=100`)
            .pipe(
              map(extractArray),
              catchError(() => of([] as Row[]))
            );
          const retailersObs = this.api
            .get<unknown>('iam', `/organizations/${orgId}/retailers?page=1&pageSize=1000`)
            .pipe(
              map(extractArray),
              catchError(() => of([] as Row[]))
            );
          const templatesObs = this.api
            .get<unknown>('workflows', '/templates')
            .pipe(
              map(extractArray),
              catchError(() => of([] as Row[]))
            );
          const formsObs = this.api
            .get<unknown>('documents', '/templates/forms')
            .pipe(
              map(extractArray),
              catchError(() => of([] as Row[]))
            );
          // B2: product fields live in the Products service (task.md Q2 answer).
          const productFieldsObs = this.api
            .get<unknown>('products', '/fields')
            .pipe(
              map(extractArray),
              catchError(() => of([] as Row[]))
            );

          return forkJoin({
            users: usersObs,
            retailers: retailersObs,
            templates: templatesObs,
            forms: formsObs,
            productFields: productFieldsObs,
          }).pipe(
            switchMap((res) => {
              const forms = toOptions(res.forms);
              const formsToFetch = forms.slice(0, 12);
              if (formsToFetch.length === 0) {
                return of({ ...res, fields: [] as any[] });
              }
              const fieldObsList = formsToFetch.map((form) =>
                this.api.get<unknown>('documents', `/templates/forms/${encodeURIComponent(form.value)}`).pipe(
                  map((body) => toLiveFields(body, form.value, form.label)),
                  catchError(() => of([]))
                )
              );
              return forkJoin(fieldObsList).pipe(
                map((fieldsLists) => ({
                  ...res,
                  fields: fieldsLists.flat(),
                }))
              );
            }),
            // B2: stages fallback — when the template LIST carries no stages,
            // pull them from per-template detail (manual §7: `/templates/{id}`).
            switchMap((res) => {
              const fromList = toTemplates(res.templates);
              if (fromList.some((t: any) => (t.stages ?? []).length > 0)) return of(res);
              const toFetch = fromList.slice(0, 8);
              if (toFetch.length === 0) return of(res);
              const detailObsList = toFetch.map((t: any) =>
                this.api.get<unknown>('workflows', `/templates/${encodeURIComponent(t.id)}`).pipe(
                  map((body) => toTemplates([body as Row])),
                  catchError(() => of([] as any[]))
                )
              );
              return forkJoin(detailObsList).pipe(
                map((detailLists) => ({ ...res, templates: [...res.templates, ...detailLists.flat()] }))
              );
            })
          );
        })
      )
      .subscribe((res) => {
        const templates = toTemplates(res.templates);
        const stages = templates.flatMap((t: any) => t.stages || []);
        const snapshot: VocabSnapshot = {
          at: Date.now(),
          users: toOptions(res.users),
          retailers: toOptions(res.retailers),
          fields: res.fields.map((f: any) => ({
            value: `ff:${f.formTemplateId}:${f.fieldId}`,
            label: f.label,
            hint: f.formName,
            unconfirmed: false,
          })),
          fieldsRaw: res.fields,
          // Flatten unique stages across templates
          stages: Array.from(new Map(stages.map((s: any) => [s.value, s])).values()),
          templates: toOptions(res.forms), // picker register maps forms in the list
          templateIds: templates.map((t: any) => t.id),
          productFields: toOptions(res.productFields),
        };
        this.apply(snapshot);
        this.cache.write(VOCAB_CACHE_KEY, snapshot);
      });
  }

  private apply(snap: VocabSnapshot) {
    this.liveUsers.set(snap.users);
    this.liveRetailers.set(snap.retailers);
    this.liveFields.set(snap.fields);
    this.liveFieldsRaw.set(snap.fieldsRaw);
    this.liveStages.set(snap.stages);
    this.liveTemplates.set(snap.templates);
    this.liveTemplateIds.set(snap.templateIds);
    this.liveProductFields.set(snap.productFields);

    const parts = [
      snap.users.length > 0 ? `${snap.users.length} users` : 'users unavailable',
      snap.retailers.length > 0 ? `${snap.retailers.length} retailers` : 'retailers unavailable',
      snap.fields.length > 0 ? `${snap.fields.length} fields` : 'fields unavailable',
      snap.stages.length > 0 ? `${snap.stages.length} stages` : 'stages unavailable',
      ...(snap.productFields.length > 0 ? [`${snap.productFields.length} product fields`] : []),
    ];

    const failures = [
      snap.users.length === 0,
      snap.retailers.length === 0,
      snap.fields.length === 0,
      snap.stages.length === 0,
    ].filter(Boolean).length;

    this.source.set(failures === 0 ? 'live' : failures === 4 ? 'static' : 'partial');
    this.detail.set(parts.join(' · '));
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
