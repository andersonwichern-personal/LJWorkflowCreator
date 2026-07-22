import { Injectable, computed, signal } from '@angular/core';

export type UserRole = 'admin' | 'senior-manager' | 'junior-analyst';

export interface RoleDefinition {
  id: UserRole;
  title: string;
  badgeTone: 'primary' | 'warn' | 'info';
  description: string;
  canDirectlyActivate: boolean;
  canApproveProposals: boolean;
  mustProposeWorkflow: boolean;
}

export const ROLES: Record<UserRole, RoleDefinition> = {
  admin: {
    id: 'admin',
    title: 'Admin',
    badgeTone: 'primary',
    description: 'Full system & execution authority. Can directly activate and approve proposals.',
    canDirectlyActivate: true,
    canApproveProposals: true,
    mustProposeWorkflow: false,
  },
  'senior-manager': {
    id: 'senior-manager',
    title: 'Senior Manager',
    badgeTone: 'info',
    description: 'Managerial review authority. Can review analyst proposals and draft team workflows.',
    canDirectlyActivate: true,
    canApproveProposals: true,
    mustProposeWorkflow: false,
  },
  'junior-analyst': {
    id: 'junior-analyst',
    title: 'Junior Analyst',
    badgeTone: 'warn',
    description: 'Maker drafting role. All created & edited workflows are submitted as proposals for review.',
    canDirectlyActivate: false,
    canApproveProposals: false,
    mustProposeWorkflow: true,
  },
};

const STORAGE_KEY = 'sweet_active_user_role';

@Injectable({ providedIn: 'root' })
export class UserSessionService {
  private readonly roleSignal = signal<UserRole>(this.loadStoredRole());

  readonly activeRole = this.roleSignal.asReadonly();
  readonly roleDef = computed(() => ROLES[this.activeRole()]);
  readonly canDirectlyActivate = computed(() => this.roleDef().canDirectlyActivate);
  readonly canApproveProposals = computed(() => this.roleDef().canApproveProposals);
  readonly mustProposeWorkflow = computed(() => this.roleDef().mustProposeWorkflow);

  setRole(role: UserRole) {
    this.roleSignal.set(role);
    try {
      localStorage.setItem(STORAGE_KEY, role);
    } catch {
      // Ignore storage restrictions
    }
  }

  private loadStoredRole(): UserRole {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as UserRole | null;
      if (stored && stored in ROLES) return stored;
    } catch {
      // Fallback
    }
    return 'admin';
  }
}
