import { Injectable } from '@nestjs/common';

/**
 * Remembers until when Telegram asked this account to wait (FLOOD_WAIT). Background work
 * (media downloads, thumbnails) starts nothing new meanwhile; mtcute itself sleeps through the
 * wait of a request already in flight.
 */
@Injectable()
export class TelegramCooldown {
  private until = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Telegram asked to wait `seconds` (a later end wins over an earlier one). */
  note(seconds: number): void {
    this.until = Math.max(this.until, this.now() + Math.max(0, seconds) * 1000);
  }

  /** Milliseconds left to wait; 0 when requests may start. */
  remainingMs(): number {
    return Math.max(0, this.until - this.now());
  }
}
