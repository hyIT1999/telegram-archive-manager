// API contracts come from @tam/shared (type-only, so no validation code reaches the bundle).
export type {
  ApiErrorBody,
  AuthUserDto,
  ChannelDto,
  ChannelStatsDto,
  ChatType,
  ImportJobDto,
  MediaCategory,
  Page,
  StatsDto,
  TelegramAuthenticateRequest,
  TelegramConnectionState,
  TelegramDialogDto,
  TelegramDialogListDto,
  TelegramStatusDto,
  TelegramUserDto,
} from '@tam/shared';

export {
  NETWORK_ERROR_MESSAGE,
  SERVER_ERROR_MESSAGE,
  UNAVAILABLE_ERROR_MESSAGE,
  UNKNOWN_ERROR_MESSAGE,
  isNotFoundError,
  retryAfterSeconds,
  toApiError,
  validationMessage,
  type ApiError,
} from './api-error';
