import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@tam/database/nest';
import { ApiErrorCode } from '@tam/shared';
import { type MessageSummaryRow, type TopicTitles, topicIdOf, topicKey } from './message.mapper.js';

export function messageNotFound(): NotFoundException {
  return new NotFoundException({ message: 'Message not found', code: ApiErrorCode.NOT_FOUND });
}

export function channelNotFound(): NotFoundException {
  return new NotFoundException({ message: 'Channel not found', code: ApiErrorCode.NOT_FOUND });
}

/** The channel and the old basic groups upgraded into it (404 when the channel is unknown). */
export async function channelWithOldGroups(
  prisma: PrismaService,
  channelId: string,
): Promise<string[]> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, migratedFrom: { select: { id: true } } },
  });
  if (!channel) {
    throw channelNotFound();
  }
  return [channel.id, ...channel.migratedFrom.map((group) => group.id)];
}

/** Names of the forum topics the rows belong to. */
export async function topicTitles(
  prisma: PrismaService,
  rows: readonly MessageSummaryRow[],
): Promise<TopicTitles> {
  const forumRows = rows.filter((row) => row.channel.isForum);
  if (forumRows.length === 0) {
    return new Map();
  }
  const topics = await prisma.forumTopic.findMany({
    where: {
      channelId: { in: [...new Set(forumRows.map((row) => row.channel.id))] },
      topicId: { in: [...new Set(forumRows.map((row) => topicIdOf(row)))] },
    },
    select: { channelId: true, topicId: true, title: true },
  });
  return new Map(topics.map((topic) => [topicKey(topic.channelId, topic.topicId), topic.title]));
}
