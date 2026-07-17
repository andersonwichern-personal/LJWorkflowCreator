import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { ApiService } from '../../../shared/api.service';
import { APP_CONFIG, isMockMode } from '../../../shared/app-config';
import { PickerOption } from './token-picker';

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

  readonly source = signal<'static' | 'live' | 'partial'>('static');
  readonly detail = signal('Demo vocabulary — configure APP_CONFIG for live tenant data.');

  // Live options registers for picker overlays
  readonly liveUsers = signal<PickerOption[]>([]);
  readonly liveRetailers = signal<PickerOption[]>([]);
  readonly liveFields = signal<PickerOption[]>([]);
  readonly liveFieldsRaw = signal<any[]>([]);
  readonly liveStages = signal<PickerOption[]>([]);
  readonly liveTemplates = signal<PickerOption[]>([]);

  constructor() {
    if (!isMockMode(this.config)) this.probe();
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

          return forkJoin({
            users: usersObs,
            retailers: retailersObs,
            templates: templatesObs,
            forms: formsObs,
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
            })
          );
        })
      )
      .subscribe((res) => {
        const usersOpt = toOptions(res.users);
        const retailersOpt = toOptions(res.retailers);
        const templates = toTemplates(res.templates);
        const formsOpt = toOptions(res.forms);

        const fieldsOpt = res.fields.map((f: any) => ({
          value: `ff:${f.formTemplateId}:${f.fieldId}`,
          label: f.label,
          hint: f.formName,
          unconfirmed: false,
        }));

        // Flatten unique stages across templates
        const stages = templates.flatMap((t: any) => t.stages || []);
        const uniqueStages: PickerOption[] = Array.from(
          new Map(stages.map((s: any) => [s.value, s])).values()
        );

        this.liveUsers.set(usersOpt);
        this.liveRetailers.set(retailersOpt);
        this.liveFields.set(fieldsOpt);
        this.liveFieldsRaw.set(res.fields);
        this.liveStages.set(uniqueStages);
        this.liveTemplates.set(formsOpt); // templates register maps forms in the list

        const parts = [
          usersOpt.length > 0 ? `${usersOpt.length} users` : 'users unavailable',
          retailersOpt.length > 0 ? `${retailersOpt.length} retailers` : 'retailers unavailable',
          fieldsOpt.length > 0 ? `${fieldsOpt.length} fields` : 'fields unavailable',
          uniqueStages.length > 0 ? `${uniqueStages.length} stages` : 'stages unavailable',
        ];

        const failures = [
          usersOpt.length === 0,
          retailersOpt.length === 0,
          fieldsOpt.length === 0,
          uniqueStages.length === 0,
        ].filter(Boolean).length;

        this.source.set(failures === 0 ? 'live' : failures === 4 ? 'static' : 'partial');
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
