import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import {
  REDIS_KEYS,
  TELEGRAM_ACCOUNT_KEY,
  type TelegramAuthenticateRequest,
  type TelegramDialogListDto,
  type TelegramRpcCall,
  type TelegramStatusDto,
} from '@tam/shared';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import { TelegramRpcClient } from './telegram-rpc.client.js';
import { toTelegramDialogDto, toTelegramStatusDto } from './telegram.mapper.js';

/**
 * Telegram endpoints. Reads come straight from PostgreSQL and Redis; every action goes to the
 * worker that owns the Telegram connection, which persists the outcome before answering.
 */
@Injectable()
export class TelegramService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly rpc: TelegramRpcClient,
  ) {}

  async status(): Promise<TelegramStatusDto> {
    const [account, heartbeat] = await Promise.all([
      this.prisma.telegramAccount.findUnique({ where: { accountKey: TELEGRAM_ACCOUNT_KEY } }),
      this.rpc.readHeartbeat(),
    ]);
    return toTelegramStatusDto(account, heartbeat);
  }

  async authenticate(request: TelegramAuthenticateRequest): Promise<TelegramStatusDto> {
    await this.rpc.call(toRpcCall(request));
    return this.status();
  }

  async logout(): Promise<TelegramStatusDto> {
    await this.rpc.call({ method: 'auth.logout' });
    return this.status();
  }

  async dialogs(): Promise<TelegramDialogListDto> {
    const [rows, refreshing, account] = await Promise.all([
      this.prisma.telegramDialog.findMany({ orderBy: [{ title: 'asc' }, { telegramChatId: 'asc' }] }),
      this.redis.exists(REDIS_KEYS.telegramDialogsRefreshing).catch(() => 0),
      this.prisma.telegramAccount.findUnique({
        where: { accountKey: TELEGRAM_ACCOUNT_KEY },
        select: { dialogsRefreshedAt: true },
      }),
    ]);
    const [archived, backupChats] = await Promise.all([
      this.prisma.channel.findMany({
        where: { telegramChatId: { in: rows.map((row) => row.telegramChatId) } },
        select: { id: true, telegramChatId: true },
      }),
      this.prisma.storageLocation.findMany({
        where: { kind: 'TELEGRAM' },
        select: { id: true, target: true },
      }),
    ]);
    const channelIdByChat = new Map(archived.map((channel) => [channel.telegramChatId, channel.id]));
    const backupIdByChat = new Map(backupChats.map((location) => [location.target, location.id]));
    return {
      items: rows.map((row) =>
        toTelegramDialogDto(
          row,
          channelIdByChat.get(row.telegramChatId) ?? null,
          backupIdByChat.get(row.telegramChatId.toString()) ?? null,
        ),
      ),
      refreshing: refreshing === 1,
      refreshedAt: account?.dialogsRefreshedAt?.toISOString() ?? null,
    };
  }

  async refreshDialogs(): Promise<TelegramDialogListDto> {
    await this.rpc.call({ method: 'dialogs.refresh' });
    return this.dialogs();
  }
}

function toRpcCall(request: TelegramAuthenticateRequest): TelegramRpcCall {
  switch (request.step) {
    case 'phone':
      return { method: 'auth.phone', phoneNumber: request.phoneNumber };
    case 'code':
      return { method: 'auth.code', code: request.code };
    case 'password':
      return { method: 'auth.password', password: request.password };
    case 'resend':
      return { method: 'auth.resend' };
  }
}
