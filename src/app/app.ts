import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/** DEV HARNESS shell — see app.html. Not part of the transplant unit. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly router = inject(Router);

  protected get workflowsActive(): boolean {
    return this.router.url.startsWith('/workflows') &&
      !this.router.url.startsWith('/workflows/proposals');
  }
}
