/** Why automatic sync switched itself off, as the channel page shows it (channels.sync_note). */
export const SYNC_NOTES = {
  protected:
    'Content protection was turned on for this chat, so its new messages are no longer archived.',
  unreadable:
    'This account can no longer read the chat, so its new messages are not archived. Switch sync on again once it can.',
} as const;

/** Why Telegram backup of a channel switched itself off (channels.backup_note). */
export const BACKUP_NOTES = {
  protected:
    'Content protection was turned on for this chat, so its messages are no longer backed up.',
} as const;
