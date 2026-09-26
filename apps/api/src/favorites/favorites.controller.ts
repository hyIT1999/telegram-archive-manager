import { Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { type FavoriteDto, type IdParam, idParamSchema } from '@tam/shared';
import { FavoritesService } from './favorites.service.js';

@Controller('messages/:id/favorite')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  /** Makes the message a favorite; asking again changes nothing. */
  @Post()
  @HttpCode(HttpStatus.OK)
  add(@Param({ schema: idParamSchema }) params: IdParam): Promise<FavoriteDto> {
    return this.favorites.set(params.id, true);
  }

  /** The message is no longer a favorite. */
  @Delete()
  remove(@Param({ schema: idParamSchema }) params: IdParam): Promise<FavoriteDto> {
    return this.favorites.set(params.id, false);
  }
}
