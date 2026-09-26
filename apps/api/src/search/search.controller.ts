import { Controller, Get, Query } from '@nestjs/common';
import { type MessagePageDto, type SearchQuery, searchQuerySchema } from '@tam/shared';
import { SearchService } from './search.service.js';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /**
   * Messages whose text, caption or file name holds every word of `q` (as the start of a word,
   * without accents); best matches first by default. Takes the filters of GET /api/messages.
   */
  @Get()
  find(@Query({ schema: searchQuerySchema }) query: SearchQuery): Promise<MessagePageDto> {
    return this.search.search(query);
  }
}
