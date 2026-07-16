import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

/** DEV HARNESS shell — see app.html. Not part of the transplant unit. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
