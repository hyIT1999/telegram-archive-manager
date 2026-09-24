/**
 * Opaque file ids stored in media.telegram_file_id. They identify a file by the message that
 * carries it, so the worker can always refetch a fresh (non-expired) file reference.
 */
export interface FileIdParts {
  chatId: string;
  messageId: string;
  fileUniqueId: string;
}

const NUMERIC = /^-?\d+$/;

export function encodeFileId({ chatId, messageId, fileUniqueId }: FileIdParts): string {
  if (!NUMERIC.test(chatId) || !NUMERIC.test(messageId) || fileUniqueId.length === 0 || fileUniqueId.includes(':')) {
    throw new Error('Invalid file id parts');
  }
  return `${chatId}:${messageId}:${fileUniqueId}`;
}

export function decodeFileId(fileId: string): FileIdParts {
  const [chatId, messageId, fileUniqueId, ...rest] = fileId.split(':');
  if (
    rest.length > 0 ||
    chatId === undefined ||
    messageId === undefined ||
    !fileUniqueId ||
    !NUMERIC.test(chatId) ||
    !NUMERIC.test(messageId)
  ) {
    throw new Error(`Invalid Telegram file id: ${JSON.stringify(fileId)}`);
  }
  return { chatId, messageId, fileUniqueId };
}
