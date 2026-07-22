import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ROLES, UserRole, UserSessionService } from './core/user-session.service';

/**
 * DEV HARNESS shell — see app.html. Not part of the transplant unit.
 *
 * Restyled as the LandJourney admin console's main-sidebar-v2 rail: a dark
 * green rail resting collapsed at 70px, expanding to 240px on hover /
 * focus-within, Material Symbols Outlined icons (weight 200), Inter text, and
 * an active pill that bleeds to the rail's right edge — matching the Angular
 * original in user-interfaces (and the sweetag-loan-syndications port).
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly router = inject(Router);
  protected readonly session = inject(UserSessionService);
  protected readonly userName = 'Admin User';
  protected readonly initials = 'AU';
  protected readonly availableRoles = Object.values(ROLES);
  protected readonly roleDropdownOpen = signal(false);

  protected toggleRoleDropdown() {
    this.roleDropdownOpen.update((open) => !open);
  }

  protected selectRole(roleId: UserRole) {
    this.session.setRole(roleId);
    this.roleDropdownOpen.set(false);
  }

  /** Collapsed-rail mark — a port of sweetag's LogoMark: a seed mid-bloom,
      concentric orbits of dots radiating from a lime core, larger to the
      right and tapering left. Deterministic (fixed precision) so it renders
      identically every time. */
  protected readonly logoDots = App.seedDots();

  private static seedDots(): ReadonlyArray<{ cx: number; cy: number; r: number }> {
    const ORBITS = [
      { radius: 10, count: 9, size: 2.1 },
      { radius: 18, count: 14, size: 1.8 },
      { radius: 26, count: 18, size: 1.5 },
    ];
    const dots: { cx: number; cy: number; r: number }[] = [];
    ORBITS.forEach((orbit, ringIndex) => {
      for (let j = 0; j < orbit.count; j++) {
        const angle = (j / orbit.count) * Math.PI * 2 + ringIndex * 0.35;
        const cx = Number((32 + orbit.radius * Math.cos(angle)).toFixed(3));
        const cy = Number((32 + orbit.radius * Math.sin(angle)).toFixed(3));
        const directionFactor = (Math.cos(angle) + 1) / 2;
        const r = Number(
          Math.max(0.3, orbit.size * (0.15 + 0.9 * directionFactor)).toFixed(3),
        );
        dots.push({ cx, cy, r });
      }
    });
    return dots;
  }

  /** Workflows list is active for /workflows and its detail/edit children,
      but NOT for the sibling /proposals or /new routes. */
  protected get workflowsActive(): boolean {
    const u = this.router.url;
    return (
      u.startsWith('/workflows') &&
      !u.startsWith('/workflows/proposals') &&
      !u.startsWith('/workflows/new')
    );
  }
}
