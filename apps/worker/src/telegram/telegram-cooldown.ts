import { Injectable } from '@nestjs/common';

/**
 * Remembers until when Telegram asked this account to wait (FLOOD_WAIT). Background work
 * (media downloads, thumbnails) starts nothing new meanwhile; mtcute itself sleeps through the
 * wait of a request already in flight.
 */
@Injectable()
export class TelegramCooldown {
  private until = 0;
  private uploadUntil = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Telegram asked to wait `seconds` (a later end wins over an earlier one). */
  note(seconds: number): void {
    this.until = Math.max(this.until, this.now() + Math.max(0, seconds) * 1000);
  }

  /** Milliseconds left to wait; 0 when requests may start. */
  remainingMs(): number {
    return Math.max(0, this.until - this.now());
  }

  /**
   * Telegram asked the parts of an upload to wait `seconds`. mtcute sleeps through it; only the
   * backups (the one thing that uploads) should know, so reading and downloading go on.
   */
  noteUpload(seconds: number): void {
    this.uploadUntil = Math.max(this.uploadUntil, this.now() + Math.max(0, seconds) * 1000);
  }

  /** Milliseconds an upload in flight still sleeps for Telegram; 0 when none does. */
  uploadRemainingMs(): number {
    return Math.max(0, this.uploadUntil - this.now());
  }
}
