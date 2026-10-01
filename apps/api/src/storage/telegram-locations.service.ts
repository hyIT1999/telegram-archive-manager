import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type StorageLocation, type TelegramDialog } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  BackupErrorCode,
  type CreateTelegramLocationRequest,
  StorageErrorCode,
  StorageKind,
  TELEGRAM_ACCOUNT_KEY,
  TelegramAuthState,
  TelegramErrorCode,
} from '@tam/shared';
import { type TelegramLocationConfig, locationConfig } from '@tam/storage';
import { TelegramRpcClient } from '../telegram/telegram-rpc.client.js';
import { telegramDisplayPath } from './storage-location.mapper.js';

/** Longest location name (see storageLocationNameSchema). */
const MAX_NAME = 80;

interface BackupProblem {
  code: string;
  message: string;
}

/** What a backup chat needs from the account: to post files, and to create topics in a forum. */
function backupProblem(dialog: TelegramDialog): BackupProblem | null {
  if (dialog.type === 'GROUP') {
    return {
      code: BackupErrorCode.BACKUP_CHAT_NOT_WRITABLE,
      message: 'Basic groups cannot receive backups. Choose a channel or a supergroup.',
    };
  }
  if (!dialog.canPost) {
    return {
      code: BackupErrorCode.BACKUP_CHAT_NOT_WRITABLE,
      message:
        'This Telegram account may not post in this chat. Choose a chat you own, or make the account an admin allowed to post.',
    };
  }
  if (dialog.isForum && !dialog.canManageTopics) {
    return {
      code: BackupErrorCode.BACKUP_CHAT_NO_TOPICS,
      message:
        'This forum does not let the account create topics. Allow it to manage topics, or choose another chat.',
    };
  }
  return null;
}

function configOf(dialog: TelegramDialog): TelegramLocationConfig {
  return {
    chatId: dialog.telegramChatId.toString(),
    title: dialog.title,
    username: dialog.username,
    type: dialog.type === 'CHANNEL' ? 'CHANNEL' : 'SUPERGROUP',
    isForum: dialog.isForum,
  };
}

/**
 * Telegram chats of the account that receive backup copies of messages (storage locations of kind
 * TELEGRAM). Only the worker talks to Telegram: it reads the chat into telegram_dialogs, and the
 * decision is made from there.
 */
@Injectable()
export class TelegramLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: TelegramRpcClient,
  ) {}

  /** Why backup chats cannot be added right now, or null. */
  async unavailableReason(): Promise<string | null> {
    const account = await this.prisma.telegramAccount.findUnique({
      where: { accountKey: TELEGRAM_ACCOUNT_KEY },
      select: { authState: true },
    });
    return account?.authState === TelegramAuthState.READY
      ? null
      : 'Sign in to Telegram first (Settings → Telegram account).';
  }

  /** Adds a chat of the account once the worker confirmed the account may post there. */
  async create(request: CreateTelegramLocationRequest): Promise<StorageLocation> {
    const chatId = BigInt(request.telegramChatId);
    const archived = await this.prisma.channel.findUnique({
      where: { telegramChatId: chatId },
      select: { id: true },
    });
    if (archived) {
      throw new ConflictException({
        code: BackupErrorCode.BACKUP_CHAT_ARCHIVED,
        message:
          'This chat is archived, so backing up into it would copy the copies. Choose a chat you only use for backups.',
      });
    }
    await this.rpc.call({ method: 'backup.checkChat', telegramChatId: request.telegramChatId });
    const dialog = await this.prisma.telegramDialog.findUnique({
      where: { telegramChatId: chatId },
    });
    if (!dialog) {
      throw new NotFoundException({
        code: TelegramErrorCode.DIALOG_NOT_FOUND,
        message: 'This chat is not in your Telegram chat list. Refresh the list and try again.',
      });
    }
    const problem = backupProblem(dialog);
    if (problem) {
      throw new UnprocessableEntityException(problem);
    }
    try {
      return await this.prisma.storageLocation.create({
        data: {
          kind: StorageKind.TELEGRAM,
          name: request.name ?? dialog.title.slice(0, MAX_NAME),
          displayPath: telegramDisplayPath(dialog.title),
          target: request.telegramChatId,
          config: { ...configOf(dialog) },
          lastCheckedAt: new Date(),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: StorageErrorCode.LOCATION_EXISTS,
          message: 'This chat already receives backups.',
        });
      }
      throw error;
    }
  }

  /**
   * Reads the chat again through the worker. Returns what is wrong for backups (null when all is
   * well) and the chat's current details; a worker that cannot be reached is an error, not a
   * problem of the chat.
   */
  async check(
    location: StorageLocation,
  ): Promise<{ problem: string | null; config: TelegramLocationConfig; displayPath: string }> {
    const current = locationConfig(location);
    if (current.kind !== 'TELEGRAM') {
      throw new Error('Not a Telegram backup chat');
    }
    try {
      await this.rpc.call({ method: 'backup.checkChat', telegramChatId: current.chatId });
    } catch (error) {
      if (codeOf(error) === TelegramErrorCode.CHAT_UNAVAILABLE) {
        return {
          problem:
            'This Telegram account can no longer read the chat (it left, or the chat is gone).',
          config: current,
          displayPath: location.displayPath,
        };
      }
      throw error;
    }
    const dialog = await this.prisma.telegramDialog.findUnique({
      where: { telegramChatId: BigInt(current.chatId) },
    });
    if (!dialog) {
      return {
        problem: 'The chat is no longer in your Telegram chat list.',
        config: current,
        displayPath: location.displayPath,
      };
    }
    return {
      problem: backupProblem(dialog)?.message ?? null,
      config: configOf(dialog),
      displayPath: telegramDisplayPath(dialog.title),
    };
  }
}

function codeOf(error: unknown): string | null {
  if (!(error instanceof HttpException)) {
    return null;
  }
  const body = error.getResponse();
  return typeof body === 'object' && body !== null && 'code' in body ? String(body.code) : null;
}
