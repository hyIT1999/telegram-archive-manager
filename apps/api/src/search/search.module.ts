import { Module } from '@nestjs/common';
import { PostgresSearchProvider } from './postgres-search.provider.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';
import { SearchProvider } from './search-provider.js';

@Module({
  controllers: [SearchController],
  providers: [SearchService, { provide: SearchProvider, useClass: PostgresSearchProvider }],
})
export class SearchModule {}
