import { Injectable } from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import type { FavoriteDto } from '@tam/shared';
import { messageNotFound } from '../messages/message-lookups.js';

/** Favorites belong to the archive: everyone who signs in sees the same ones. */
@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Makes a message a favorite or not. Asking again changes nothing, so a favorite keeps the date
   * it was first favorited.
   */
  async set(messageId: string, favorite: boolean): Promise<FavoriteDto> {
    await this.prisma.message.updateMany({
      where: { id: messageId, isFavorite: !favorite },
      data: { isFavorite: favorite, favoritedAt: favorite ? new Date() : null },
    });
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { isFavorite: true, favoritedAt: true },
    });
    if (!message) {
      throw messageNotFound();
    }
    return {
      isFavorite: message.isFavorite,
      favoritedAt: message.favoritedAt?.toISOString() ?? null,
    };
  }
}
