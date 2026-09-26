import { Injectable, Logger } from '@nestjs/common';
import type { UpdateEvent } from '@tam/telegram';
import { errorMessage } from '../common/error-message.js';

export type UpdateListener = (event: UpdateEvent) => void;

/**
 * Telegram's updates for the whole worker. The connection feeds the client of every connection
 * into this one emitter, so listeners subscribe once and survive reconnects.
 */
@Injectable()
export class TelegramUpdates {
  private readonly logger = new Logger(TelegramUpdates.name);
  private readonly listeners = new Set<UpdateListener>();
  private starter: (() => Promise<void>) | undefined;

  /** Adds a listener; the returned function removes it. */
  listen(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Hands an update of the current client to every listener. */
  emit(event: UpdateEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn(`A listener failed on a Telegram update: ${errorMessage(error)}`);
      }
    }
  }

  /** How the current client starts receiving updates; undefined while disconnected. */
  attach(starter: (() => Promise<void>) | undefined): void {
    this.starter = starter;
  }

  /** Starts (or keeps) receiving updates; false while there is no connection. */
  async start(): Promise<boolean> {
    const starter = this.starter;
    if (!starter) {
      return false;
    }
    await starter();
    return true;
  }
}
