import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { LjPage } from '../../shared/lj/lj';

interface AccountState {
  name: string;
  title: string;
  email: string;
  startPage: string;
  density: string;
  twoFactor: boolean;
}

const DEFAULTS: AccountState = {
  name: 'Admin User',
  title: 'Operations Lead',
  email: 'admin@sweettech.example',
  startPage: 'dashboard',
  density: 'comfortable',
  twoFactor: true,
};

const SESSIONS = [
  { device: 'Chrome · macOS', where: 'This device', when: 'Active now', current: true },
  { device: 'Safari · iPhone', where: 'Boston, US', when: '2 days ago', current: false },
];

/**
 * Account — profile, app preferences and security for the signed-in user.
 * Local + persisted (standalone demo shell, no account backend). Credential
 * changes are delegated, never collected here.
 */
@Component({
  selector: 'sw-account',
  standalone: true,
  imports: [LjPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <lj-page>
      <header header class="page-header">
        <p class="eyebrow">Account</p>
        <h1 lj-page-heading>Your account</h1>
        <p class="intro">Profile, preferences and security.</p>
      </header>

      <div class="stack">
        <section class="card profile">
          <div class="avatar">{{ initials() }}</div>
          <div class="who">
            <strong>{{ a().name }}</strong>
            <span>{{ a().title }} · {{ a().email }}</span>
            <span class="role"><span class="msym">shield_person</span>Platform administrator</span>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><span class="msym">badge</span><div><h2>Profile</h2><p>How you appear across the workspace.</p></div></div>
          <div class="fields">
            <label class="field">
              <span class="f-label">Display name</span>
              <input class="control" type="text" [value]="a().name" (input)="set('name', asValue($event))" />
            </label>
            <label class="field">
              <span class="f-label">Job title</span>
              <input class="control" type="text" [value]="a().title" (input)="set('title', asValue($event))" />
            </label>
            <label class="field">
              <span class="f-label">Email</span>
              <input class="control" type="email" [value]="a().email" (input)="set('email', asValue($event))" />
            </label>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><span class="msym">tune</span><div><h2>Preferences</h2><p>Tailor the app to how you work.</p></div></div>
          <div class="fields">
            <label class="field">
              <span class="f-label">Start page</span>
              <select class="control" [value]="a().startPage" (change)="set('startPage', asValue($event))">
                <option value="dashboard">Dashboard</option>
                <option value="workflows">Workflows</option>
              </select>
            </label>
            <label class="field">
              <span class="f-label">Density</span>
              <select class="control" [value]="a().density" (change)="set('density', asValue($event))">
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><span class="msym">lock</span><div><h2>Security</h2><p>Protect access to your account.</p></div></div>
          <div class="fields">
            <div class="field">
              <span class="f-label">Two-factor authentication<small>Require a second factor at sign-in.</small></span>
              <button type="button" role="switch" class="switch" [class.on]="a().twoFactor" [attr.aria-checked]="a().twoFactor" (click)="toggle('twoFactor')"><span class="knob"></span></button>
            </div>
            <div class="field">
              <span class="f-label">Password<small>Managed by your identity provider.</small></span>
              <button type="button" class="btn">Manage password</button>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><span class="msym">devices</span><div><h2>Active sessions</h2><p>Where you're currently signed in.</p></div></div>
          <ul class="sessions">
            @for (sess of sessions; track sess.device) {
              <li>
                <span class="msym s-icon">{{ sess.current ? 'computer' : 'smartphone' }}</span>
                <span class="s-main"><b>{{ sess.device }}</b><small>{{ sess.where }} · {{ sess.when }}</small></span>
                @if (sess.current) { <span class="chip">This device</span> }
                @else { <button type="button" class="btn ghost">Sign out</button> }
              </li>
            }
          </ul>
        </section>

        <div class="save-row">
          <button type="button" class="btn danger"><span class="msym">logout</span>Sign out</button>
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
    .profile { display: flex; align-items: center; gap: var(--space-5); }
    .avatar {
      flex: 0 0 auto; width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      background: var(--brand); color: #fff; font-weight: 800; font-size: 1.4rem;
    }
    .who { display: flex; flex-direction: column; gap: 3px; }
    .who strong { font-size: var(--text-lg); font-weight: 800; color: var(--text); }
    .who span { color: var(--text-dim); font-size: var(--text-sm); }
    .who .role { display: inline-flex; align-items: center; gap: 5px; color: var(--brand-text); font-weight: 600; margin-top: 2px; }
    .who .role .msym { font-size: 16px; }
    .card-head { display: flex; align-items: flex-start; gap: var(--space-3); margin-block-end: var(--space-5); }
    .card-head .msym { font-size: 22px; color: var(--brand); }
    .card-head h2 { margin: 0; font-size: var(--text-lg); font-weight: 700; color: var(--text); }
    .card-head p { margin: 2px 0 0; color: var(--text-dim); font-size: var(--text-sm); }
    .fields { display: flex; flex-direction: column; }
    .field { display: flex; align-items: center; justify-content: space-between; gap: var(--space-5); padding: var(--space-4) 0; border-top: 1px solid var(--border); }
    .field:first-child { border-top: none; padding-top: 0; }
    .f-label { display: flex; flex-direction: column; gap: 3px; font-size: var(--text-sm); font-weight: 600; color: var(--text); }
    .f-label small { font-weight: 400; color: var(--text-dim); font-size: var(--text-xs); }
    .control { min-width: 260px; height: 40px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); color: var(--text); font: inherit; font-size: var(--text-sm); }
    .control:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--focus-ring); }
    .switch { position: relative; width: 44px; height: 26px; border-radius: var(--radius-pill); border: none; flex: 0 0 auto; background: var(--border-strong); cursor: pointer; transition: background .18s; }
    .switch.on { background: var(--brand); }
    .knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .18s; box-shadow: var(--shadow-soft); }
    .switch.on .knob { transform: translateX(18px); }
    .sessions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .sessions li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4) 0; border-top: 1px solid var(--border); }
    .sessions li:first-child { border-top: none; padding-top: 0; }
    .s-icon { font-size: 22px; color: var(--text-dim); }
    .s-main { flex: 1; display: flex; flex-direction: column; }
    .s-main b { font-size: var(--text-sm); font-weight: 600; color: var(--text); }
    .s-main small { color: var(--text-dim); font-size: var(--text-xs); }
    .chip { padding: 3px 10px; border-radius: var(--radius-pill); background: var(--info-bg); color: var(--brand-text); font-size: var(--text-xs); font-weight: 700; }
    .btn { min-height: 40px; display: inline-flex; align-items: center; gap: 6px; padding: 0 16px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); color: var(--text); font-weight: 700; font-size: var(--text-sm); cursor: pointer; }
    .btn:hover { background: var(--surface-hover); }
    .btn.ghost { min-height: 34px; padding: 0 12px; font-weight: 600; color: var(--text-dim); }
    .btn.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
    .btn.primary:hover { background: var(--brand-hover); }
    .btn.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 28%, var(--border)); }
    .btn .msym { font-size: 18px; }
    .save-row { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-4); }
    .save-row .btn.danger { margin-right: auto; }
    .saved { display: inline-flex; align-items: center; gap: 6px; color: var(--success, #176b4d); font-size: var(--text-sm); font-weight: 600; opacity: 0; transition: opacity .2s; }
    .saved.show { opacity: 1; }
    .saved .msym { font-size: 18px; }
  `,
})
export class AccountPage {
  private readonly STORE = 'sw-account';
  protected readonly a = signal<AccountState>(this.load());
  protected readonly justSaved = signal(false);
  protected readonly sessions = SESSIONS;
  protected readonly initials = computed(() =>
    this.a().name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'U',
  );

  protected asValue(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }
  protected set<K extends keyof AccountState>(k: K, v: AccountState[K]): void {
    this.a.update((cur) => ({ ...cur, [k]: v }));
  }
  protected toggle(k: 'twoFactor'): void {
    this.a.update((cur) => ({ ...cur, [k]: !cur[k] }));
  }
  protected save(): void {
    try {
      localStorage.setItem(this.STORE, JSON.stringify(this.a()));
    } catch {
      /* storage unavailable */
    }
    this.justSaved.set(true);
    setTimeout(() => this.justSaved.set(false), 1800);
  }
  private load(): AccountState {
    try {
      const raw = localStorage.getItem(this.STORE);
      if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AccountState>) };
    } catch {
      /* ignore */
    }
    return { ...DEFAULTS };
  }
}
