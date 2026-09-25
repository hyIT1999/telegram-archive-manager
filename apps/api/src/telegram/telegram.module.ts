import { Module } from '@nestjs/common';
import { TelegramRpcClient } from './telegram-rpc.client.js';
import { TelegramController } from './telegram.controller.js';
import { TelegramService } from './telegram.service.js';

@Module({
  controllers: [TelegramController],
  providers: [TelegramRpcClient, TelegramService],
  // One RPC client per api process (it keeps a Redis subscription for the replies).
  exports: [TelegramRpcClient],
})
export class TelegramModule {}
