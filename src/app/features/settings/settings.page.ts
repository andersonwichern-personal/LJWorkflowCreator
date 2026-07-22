import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LjPage } from '../../shared/lj/lj';

interface SettingsState {
  orgName: string;
  timezone: string;
  weekStart: string;
  fourEyes: boolean;
  startObserving: boolean;
  channel: string;
  emailOnReview: boolean;
  dailyDigest: boolean;
}

const DEFAULTS: SettingsState = {
  orgName: 'Sweet Tech',
  timezone: 'America/New_York',
  weekStart: 'sun',
  fourEyes: true,
  startObserving: true,
  channel: 'email',
  emailOnReview: true,
  dailyDigest: false,
};

/**
 * Settings — workspace, automation defaults and notification preferences for
 * the Workflow Creator. State is local + persisted to localStorage (this is a
 * standalone demo shell with no settings backend); every control is live.
 */
@Component({
  selector: 'sw-settings',
  standalone: true,
  imports: [LjPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <lj-page>
      <header header class="page-header">
        <p class="eyebrow">Workspace</p>
        <h1 lj-page-heading>Settings</h1>
        <p class="intro">Defaults for how automations behave and who gets told.</p>
      </header>

      <div class="stack">
        <section class="card">
          <div class="card-head"><span class="msym">apartment</span><div><h2>Workspace</h2><p>Identity & locale for this organization.</p></div></div>
          <div class="fields">
            <label class="field">
              <span class="f-label">Organization name</span>
              <input class="control" type="text" [value]="s().orgName" (input)="set('orgName', asValue($event))" />
            </label>
            <label class="field">
              <span class="f-label">Time zone</span>
              <select class="control" [value]="s().timezone" (change)="set('timezone', asValue($event))">
                <option value="America/New_York">Eastern (New York)</option>
                <option value="America/Chicago">Central (Chicago)</option>
                <option value="America/Denver">Mountain (Denver)</option>
                <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
                <option value="UTC">UTC</option>
              </select>
            </label>
            <label class="field">
              <span class="f-label">Week starts on</span>
              <select class="control" [value]="s().weekStart" (change)="set('weekStart', asValue($event))">
                <option value="sun">Sunday</option>
                <option value="mon">Monday</option>
              </select>
            </label>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><span class="msym">bolt</span><div><h2>Automation defaults</h2><p>Applied to newly created workflows.</p></div></div>
          <div class="fields">
            <div class="field">
              <span class="f-label">Require four-eyes review<small>Changes to protected workflows become proposals.</small></span>
              <button type="button" role="switch" class="switch" [class.on]="s().fourEyes" [attr.aria-checked]="s().fourEyes" (click)="toggle('fourEyes')"><span class="knob"></span></button>
            </div>
            <div class="field">
              <span class="f-label">New workflows start observing<small>Off means new workflows begin paused.</small></span>
              <button type="button" role="switch" class="switch" [class.on]="s().startObserving" [attr.aria-checked]="s().startObserving" (click)="toggle('startObserving')"><span class="knob"></span></button>
            </div>
            <label class="field">
              <span class="f-label">Default notification channel</span>
              <select class="control" [value]="s().channel" (change)="set('channel', asValue($event))">
                <option value="email">Email</option>
                <option value="slack">Slack</option>
                <option value="none">None</option>
              </select>
            </label>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><span class="msym">notifications</span><div><h2>Notifications</h2><p>What lands in your inbox.</p></div></div>
          <div class="fields">
            <div class="field">
              <span class="f-label">Email me on review requests</span>
              <button type="button" role="switch" class="switch" [class.on]="s().emailOnReview" [attr.aria-checked]="s().emailOnReview" (click)="toggle('emailOnReview')"><span class="knob"></span></button>
            </div>
            <div class="field">
              <span class="f-label">Daily activity digest</span>
              <button type="button" role="switch" class="switch" [class.on]="s().dailyDigest" [attr.aria-checked]="s().dailyDigest" (click)="toggle('dailyDigest')"><span class="knob"></span></button>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><span class="msym">tune</span><div><h2>Dashboard</h2><p>Reset the customizable dashboard layout.</p></div></div>
          <div class="fields">
            <div class="field">
              <span class="f-label">Dashboard layout<small>{{ resetDone() ? 'Reset — reload the dashboard to see defaults.' : 'Restore the default tiles and panels.' }}</small></span>
              <button type="button" class="btn" (click)="resetLayout()">Reset layout</button>
            </div>
          </div>
        </section>

        <div class="save-row">
          <span class="saved" [class.show]="justSaved()"><span class="msym">check_circle</span>Saved</span>
          <button type="button" class="btn primary" (click)="save()">Save changes</button>
        </div>
      </div>
    </lj-page>
  `,
  styles: `
    .page-header { padding: var(--space-6) clamp(24px, 3vw, 40px) var(--space-3); }
    .eyebrow { margin: 0 0 var(--space-1); color: var(--brand-text); font-size: var(--text-xs); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: var(--text-xl); font-weight: 800; color: var(--text); }
    .intro { margin: var(--space-1) 0 0; color: var(--text-dim); }
    .stack { max-width: 760px; display: flex; flex-direction: column; gap: var(--space-4); }
    .card { padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-soft); }
    .card-head { display: flex; align-items: flex-start; gap: var(--space-3); margin-block-end: var(--space-5); }
    .card-head .msym { font-size: 22px; color: var(--brand); }
    .card-head h2 { margin: 0; font-size: var(--text-lg); font-weight: 700; color: var(--text); }
    .card-head p { margin: 2px 0 0; color: var(--text-dim); font-size: var(--text-sm); }
    .fields { display: flex; flex-direction: column; }
    .field { display: flex; align-items: center; justify-content: space-between; gap: var(--space-5); padding: var(--space-4) 0; border-top: 1px solid var(--border); }
    .field:first-child { border-top: none; padding-top: 0; }
    .f-label { display: flex; flex-direction: column; gap: 3px; font-size: var(--text-sm); font-weight: 600; color: var(--text); }
    .f-label small { font-weight: 400; color: var(--text-dim); font-size: var(--text-xs); }
    .control {
      min-width: 220px; height: 40px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius-md);
      background: var(--surface); color: var(--text); font: inherit; font-size: var(--text-sm);
    }
    .control:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--focus-ring); }
    .switch {
      position: relative; width: 44px; height: 26px; border-radius: var(--radius-pill); border: none; flex: 0 0 auto;
      background: var(--border-strong); cursor: pointer; transition: background .18s;
    }
    .switch.on { background: var(--brand); }
    .knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .18s; box-shadow: var(--shadow-soft); }
    .switch.on .knob { transform: translateX(18px); }
    .btn {
      min-height: 40px; display: inline-flex; align-items: center; gap: 6px; padding: 0 16px;
      border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface);
      color: var(--text); font-weight: 700; font-size: var(--text-sm); cursor: pointer;
    }
    .btn:hover { background: var(--surface-hover); }
    .btn.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
    .btn.primary:hover { background: var(--brand-hover); }
    .save-row { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-4); }
    .saved { display: inline-flex; align-items: center; gap: 6px; color: var(--success, #176b4d); font-size: var(--text-sm); font-weight: 600; opacity: 0; transition: opacity .2s; }
    .saved.show { opacity: 1; }
    .saved .msym { font-size: 18px; }
  `,
})
export class SettingsPage {
  private readonly STORE = 'sw-settings';
  protected readonly s = signal<SettingsState>(this.load());
  protected readonly justSaved = signal(false);
  protected readonly resetDone = signal(false);

  protected asValue(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }
  protected set<K extends keyof SettingsState>(k: K, v: SettingsState[K]): void {
    this.s.update((cur) => ({ ...cur, [k]: v }));
  }
  protected toggle(k: 'fourEyes' | 'startObserving' | 'emailOnReview' | 'dailyDigest'): void {
    this.s.update((cur) => ({ ...cur, [k]: !cur[k] }));
  }
  protected save(): void {
    try {
      localStorage.setItem(this.STORE, JSON.stringify(this.s()));
    } catch {
      /* storage unavailable */
    }
    this.justSaved.set(true);
    setTimeout(() => this.justSaved.set(false), 1800);
  }
  protected resetLayout(): void {
    try {
      localStorage.removeItem('sw-dashboard-layout-v3');
    } catch {
      /* ignore */
    }
    this.resetDone.set(true);
  }
  private load(): SettingsState {
    try {
      const raw = localStorage.getItem(this.STORE);
      if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SettingsState>) };
    } catch {
      /* ignore */
    }
    return { ...DEFAULTS };
  }
}
