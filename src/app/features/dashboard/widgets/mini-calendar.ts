import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const key = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const nthWeekday = (y: number, m: number, wd: number, n: number) => {
  const first = new Date(y, m, 1).getDay();
  return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
};
const lastWeekday = (y: number, m: number, wd: number) => {
  const last = new Date(y, m + 1, 0).getDate();
  const lastWd = new Date(y, m, last).getDay();
  return last - ((lastWd - wd + 7) % 7);
};
const observed = (y: number, m: number, d: number) => {
  const wd = new Date(y, m, d).getDay();
  return wd === 6 ? d - 1 : wd === 0 ? d + 1 : d;
};

// US Federal Reserve holiday schedule — the calendar automation actually runs
// against (bank-business days), not a generic holiday list.
function bankHolidays(y: number): Map<string, string> {
  const map = new Map<string, string>();
  const add = (m: number, d: number, name: string) => map.set(key(y, m, d), name);
  add(0, observed(y, 0, 1), "New Year's Day");
  add(0, nthWeekday(y, 0, 1, 3), 'Martin Luther King Jr. Day');
  add(1, nthWeekday(y, 1, 1, 3), "Washington's Birthday");
  add(4, lastWeekday(y, 4, 1), 'Memorial Day');
  add(5, observed(y, 5, 19), 'Juneteenth');
  add(6, observed(y, 6, 4), 'Independence Day');
  add(8, nthWeekday(y, 8, 1, 1), 'Labor Day');
  add(9, nthWeekday(y, 9, 1, 2), 'Columbus Day');
  add(10, observed(y, 10, 11), 'Veterans Day');
  add(10, nthWeekday(y, 10, 4, 4), 'Thanksgiving Day');
  add(11, observed(y, 11, 25), 'Christmas Day');
  return map;
}

interface Cell {
  key: string; day: number; inMonth: boolean; isToday: boolean;
  isWeekend: boolean; holiday: string | null; active: boolean;
}

/**
 * Informational month calendar (ported from sweetag's MiniCalendar): shades
 * weekends, highlights & lists Federal Reserve bank holidays, pageable to any
 * month. Days on which a workflow was created or last touched get an accent
 * dot, so it also reads as an activity ribbon.
 */
@Component({
  selector: 'sw-mini-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <span class="title">{{ monthLabel() }} {{ view().year }}</span>
      <div class="nav">
        <button type="button" (click)="goToday()">Today</button>
        <button type="button" aria-label="Previous month" (click)="go(-1)"><span class="msym">chevron_left</span></button>
        <button type="button" aria-label="Next month" (click)="go(1)"><span class="msym">chevron_right</span></button>
      </div>
    </div>
    <div class="grid">
      @for (w of weekdays; track $index) {
        <div class="wd" [class.we]="$index === 0 || $index === 6">{{ w }}</div>
      }
      @for (c of cells(); track c.key) {
        <div class="cell" [class.shade]="c.isWeekend && c.inMonth" [title]="c.holiday ?? ''">
          <span class="num"
            [class.out]="!c.inMonth"
            [class.today]="c.isToday"
            [class.holiday]="!c.isToday && !!c.holiday && c.inMonth">{{ c.day }}</span>
          <span class="mark"
            [class.hol]="c.holiday && c.inMonth && !c.isToday"
            [class.act]="c.active && c.inMonth && !c.holiday && !c.isToday"></span>
        </div>
      }
    </div>
    @if (monthHolidays().length) {
      <div class="hol-list">
        @for (h of monthHolidays(); track h.key) {
          <div class="hol-row"><span class="hdot"></span><b>{{ monthLabel().slice(0, 3) }} {{ h.day }}</b> — {{ h.name }}</div>
        }
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; justify-content: space-between; }
    .head { display: flex; align-items: center; justify-content: space-between; margin-block-end: var(--space-3); flex: 0 0 auto; }
    .title { font-size: var(--text-sm); font-weight: 700; color: var(--text); }
    .nav { display: flex; align-items: center; gap: var(--space-1); }
    .nav button {
      display: inline-flex; align-items: center; justify-content: center; height: 28px; min-width: 28px; padding: 0 8px;
      border: none; border-radius: var(--radius-md); background: transparent; color: var(--text-dim);
      font-size: var(--text-xs); font-weight: 600; cursor: pointer;
    }
    .nav button:hover { background: var(--surface-inset); color: var(--text); }
    .nav .msym { font-size: 18px; }
    .grid { display: grid; grid-template-columns: repeat(7, 1fr); row-gap: var(--space-1); text-align: center; }
    .wd { padding-block-end: 4px; font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-dim); }
    .wd.we { opacity: .6; }
    .cell { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 3px 0; border-radius: var(--radius-md); }
    .cell.shade { background: var(--surface-inset); }
    .num {
      display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 50%;
      font-size: var(--text-xs); color: var(--text);
    }
    .num.out { color: color-mix(in srgb, var(--text-dim) 55%, transparent); }
    .num.today { background: var(--brand); color: #fff; font-weight: 700; }
    .num.holiday { background: var(--info-bg); color: var(--brand-text); font-weight: 600; }
    .mark { width: 4px; height: 4px; border-radius: 50%; background: transparent; }
    .mark.hol { background: var(--brand); }
    .mark.act { background: var(--accent); }
    .hol-list { margin-block-start: var(--space-3); padding-block-start: var(--space-2); border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-1); }
    .hol-row { display: flex; align-items: center; gap: 6px; font-size: var(--text-xs); color: var(--text-dim); }
    .hol-row b { color: var(--text); font-weight: 600; }
    .hdot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); flex: 0 0 auto; }
  `,
})
export class MiniCalendar {
  @Input() set activeDays(v: string[]) {
    this._active.set(new Set(v ?? []));
  }

  private readonly _active = signal<Set<string>>(new Set());
  readonly weekdays = WEEKDAY_LABELS;
  private readonly now = new Date();
  protected readonly view = signal({ year: this.now.getFullYear(), month: this.now.getMonth() });
  protected readonly monthLabel = computed(() => MONTH_LABELS[this.view().month]);

  private readonly holidays = computed(() => {
    const { year } = this.view();
    const merged = new Map<string, string>();
    for (const y of [year - 1, year, year + 1]) bankHolidays(y).forEach((n, k) => merged.set(k, n));
    return merged;
  });

  protected readonly cells = computed<Cell[]>(() => {
    const { year, month } = this.view();
    const hol = this.holidays();
    const active = this._active();
    const todayKey = key(this.now.getFullYear(), this.now.getMonth(), this.now.getDate());
    const firstWd = new Date(year, month, 1).getDay();
    const daysIn = new Date(year, month + 1, 0).getDate();
    const daysPrev = new Date(year, month, 0).getDate();
    const out: Cell[] = [];
    for (let i = firstWd - 1; i >= 0; i--) {
      const day = daysPrev - i;
      const m = month === 0 ? 11 : month - 1;
      const y = month === 0 ? year - 1 : year;
      out.push({ key: key(y, m, day), day, inMonth: false, isToday: false, isWeekend: false, holiday: null, active: false });
    }
    for (let day = 1; day <= daysIn; day++) {
      const k = key(year, month, day);
      const wd = new Date(year, month, day).getDay();
      out.push({ key: k, day, inMonth: true, isToday: k === todayKey, isWeekend: wd === 0 || wd === 6, holiday: hol.get(k) ?? null, active: active.has(k) });
    }
    let next = 1;
    while (out.length % 7 !== 0) {
      const m = month === 11 ? 0 : month + 1;
      const y = month === 11 ? year + 1 : year;
      out.push({ key: key(y, m, next), day: next, inMonth: false, isToday: false, isWeekend: false, holiday: null, active: false });
      next++;
    }
    return out;
  });

  protected readonly monthHolidays = computed(() => {
    const { year, month } = this.view();
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    return [...this.holidays().entries()]
      .filter(([k]) => k.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, name]) => ({ key: k, day: Number(k.slice(-2)), name }));
  });

  protected go(delta: number): void {
    const d = new Date(this.view().year, this.view().month + delta, 1);
    this.view.set({ year: d.getFullYear(), month: d.getMonth() });
  }
  protected goToday(): void {
    this.view.set({ year: this.now.getFullYear(), month: this.now.getMonth() });
  }
}
