import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { ConfirmService } from './confirm-service';

describe('ConfirmService', () => {
  let confirm: ConfirmService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    });
    confirm = TestBed.inject(ConfirmService);
  });

  async function openDialog(): Promise<{ answer: Promise<boolean>; buttons: HTMLButtonElement[] }> {
    const answer = confirm.ask({
      title: 'Delete tag?',
      message: 'Messages keep their content.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    TestBed.tick();
    const dialog = await vi.waitFor(() => {
      const element = document.querySelector('app-confirm-dialog');
      if (!element) {
        throw new Error('dialog not open yet');
      }
      return element;
    });
    return { answer, buttons: Array.from(dialog.querySelectorAll('button')) };
  }

  it('shows the question and resolves true on confirm', async () => {
    const { answer, buttons } = await openDialog();
    const dialog = document.querySelector('app-confirm-dialog');

    expect(dialog?.textContent).toContain('Delete tag?');
    expect(dialog?.textContent).toContain('Messages keep their content.');
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Cancel', 'Delete']);

    buttons[1].click();
    await expect(answer).resolves.toBe(true);
  });

  it('resolves false on cancel', async () => {
    const { answer, buttons } = await openDialog();

    buttons[0].click();
    await expect(answer).resolves.toBe(false);
  });
});
