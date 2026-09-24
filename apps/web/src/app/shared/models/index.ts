// API contracts come from @tam/shared (type-only, so no validation code reaches the bundle).
export type {
  ApiErrorBody,
  AuthUserDto,
  ChannelDto,
  ChannelStatsDto,
  ImportJobDto,
  MediaCategory,
  Page,
  StatsDto,
} from '@tam/shared';

export {
  NETWORK_ERROR_MESSAGE,
  SERVER_ERROR_MESSAGE,
  UNAVAILABLE_ERROR_MESSAGE,
  UNKNOWN_ERROR_MESSAGE,
  isNotFoundError,
  toApiError,
  type ApiError,
} from './api-error';
