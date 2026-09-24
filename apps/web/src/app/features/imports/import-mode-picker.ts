import { Component, computed, model, signal } from '@angular/core';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import type { ImportMode } from '../../shared/models';
import { type ImportChoice, importChoiceProblem, todayInputValue } from './import-labels';

export const DEFAULT_IMPORT_CHOICE: ImportChoice = { mode: 'ALL', fromDay: '' };

/** Chooses what to import: the whole history, or the messages sent since a day. */
@Component({
  selector: 'app-import-mode-picker',
  imports: [MatFormField, MatHint, MatInput, MatLabel],
  templateUrl: './import-mode-picker.html',
  styleUrl: './import-mode-picker.scss',
})
export class ImportModePicker {
  /** The choice, two-way bound (`[(choice)]`). */
  readonly choice = model<ImportChoice>(DEFAULT_IMPORT_CHOICE);

  /** The latest day that can be picked (today, in the browser's time zone). */
  protected readonly today = todayInputValue();
  /** Problems show once the day field was used, not while the user is still choosing. */
  private readonly dayTouched = signal(false);
  protected readonly problem = computed(() =>
    this.dayTouched() ? importChoiceProblem(this.choice()) : null,
  );

  protected setMode(mode: ImportMode): void {
    this.choice.update((choice) => ({ ...choice, mode }));
  }

  protected setDay(event: Event): void {
    const fromDay = (event.target as HTMLInputElement).value;
    this.dayTouched.set(true);
    this.choice.update((choice) => ({ ...choice, fromDay }));
  }
}
