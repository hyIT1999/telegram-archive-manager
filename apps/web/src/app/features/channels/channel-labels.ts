import type { ChannelDto } from '../../shared/models';

const CHAT_TYPE_LABELS: Record<ChannelDto['type'], string> = {
  CHANNEL: 'Channel',
  SUPERGROUP: 'Supergroup',
  GROUP: 'Group',
};

export function chatTypeLabel(type: ChannelDto['type']): string {
  return CHAT_TYPE_LABELS[type];
}

/** "@username" for public chats, "Private" otherwise. */
export function channelHandle(channel: Pick<ChannelDto, 'username'>): string {
  return channel.username ? `@${channel.username}` : 'Private';
}

/** Up to two initials for the avatar, e.g. "Daily Physics" → "DP". */
export function channelInitials(title: string): string {
  const words = title
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const initials = words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('');
  return initials.toUpperCase() || '#';
}

/** Public link to the chat in Telegram, only for chats that have a username. */
export function telegramUrl(channel: Pick<ChannelDto, 'username'>): string | null {
  return channel.username ? `https://t.me/${encodeURIComponent(channel.username)}` : null;
}
